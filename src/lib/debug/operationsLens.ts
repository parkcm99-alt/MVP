import type { AgentTraceRow } from '@/lib/supabase/types';
import type { AgentRole, SimEvent, SimTask, TaskPriority, TaskStatus } from '@/types';
import { eventMatchesTrace, normalizeMatch, taskMatchesEvent, taskMatchesTrace, traceTaskTitle } from './correlation';
import { redactSensitiveText, sanitizeTraceMetadata } from '@/lib/supabase/traces';

export interface OperationsLensFilters {
  role: 'all' | AgentRole;
  taskStatus: 'all' | TaskStatus;
  priority: 'all' | TaskPriority;
  traceType: 'all' | 'llm_call' | 'handoff' | 'decision' | 'tool_use';
  sessionId: string;
  keyword: string;
}

export const EMPTY_LENS_FILTERS: OperationsLensFilters = {
  role: 'all', taskStatus: 'all', priority: 'all', traceType: 'all', sessionId: '', keyword: '',
};

export function isLensActive(filters: OperationsLensFilters): boolean {
  return filters.role !== 'all' || filters.taskStatus !== 'all' || filters.priority !== 'all'
    || filters.traceType !== 'all' || Boolean(filters.sessionId.trim() || filters.keyword.trim());
}

interface LensResult {
  tasks: SimTask[];
  events: SimEvent[];
  traces: AgentTraceRow[];
  warnings: string[];
}

function includes(value: string, query: string): boolean {
  return !query || normalizeMatch(value).includes(normalizeMatch(query));
}

function safeMetadataText(metadata: Record<string, unknown> | null | undefined): string {
  return JSON.stringify(sanitizeTraceMetadata(metadata) ?? {});
}

function taskText(task: SimTask): string {
  return redactSensitiveText([task.title, task.description, task.assignedTo, task.status, task.priority, task.sessionId].join(' '));
}

function eventText(event: SimEvent): string {
  return redactSensitiveText([event.message, event.agentId, event.type, event.sessionId, safeMetadataText(event.metadata)].join(' '));
}

function traceText(trace: AgentTraceRow): string {
  return redactSensitiveText([trace.agent_id, trace.trace_type, trace.session_id, trace.model, safeMetadataText(trace.metadata)].join(' '));
}

function traceRoleMatches(trace: AgentTraceRow, role: AgentRole): boolean {
  return trace.agent_id === role || trace.metadata?.target_agent === role || trace.metadata?.assigned_to === role;
}

function taskCriteria(task: SimTask, filters: OperationsLensFilters): boolean {
  return (filters.role === 'all' || task.assignedTo === filters.role)
    && (filters.taskStatus === 'all' || task.status === filters.taskStatus)
    && (filters.priority === 'all' || task.priority === filters.priority)
    && includes(task.sessionId ?? '', filters.sessionId.trim())
    && includes(taskText(task), filters.keyword.trim());
}

function relatedTaskCriteria(tasks: SimTask[], filters: OperationsLensFilters): boolean {
  if (filters.taskStatus === 'all' && filters.priority === 'all') return true;
  return tasks.some(task => (filters.taskStatus === 'all' || task.status === filters.taskStatus)
    && (filters.priority === 'all' || task.priority === filters.priority));
}

function warningsFor(tasks: SimTask[], events: SimEvent[], traces: AgentTraceRow[], active: boolean): string[] {
  if (!active) return [];
  const withoutLinks = tasks.filter(task => !events.some(event => taskMatchesEvent(task, event))
    && !traces.some(trace => taskMatchesTrace(task, trace)));
  const sessionMismatch = tasks.filter(task => task.sessionId && (
    events.some(event => taskMatchesEvent(task, event) && event.sessionId && event.sessionId !== task.sessionId)
    || traces.some(trace => taskMatchesTrace(task, trace) && trace.session_id !== task.sessionId)
  ));
  const roleMismatch = tasks.filter(task => task.assignedTo && (
    events.some(event => taskMatchesEvent(task, event) && event.agentId !== task.assignedTo)
    || traces.some(trace => taskMatchesTrace(task, trace) && !traceRoleMatches(trace, task.assignedTo!))
  ));
  const output: string[] = [];
  if (withoutLinks.length) output.push(`${withoutLinks.length} filtered task(s)에 관련 event/trace가 없습니다. Refresh 또는 task 제목을 확인하세요.`);
  if (sessionMismatch.length) output.push(`${sessionMismatch.length} task correlation에서 sessionId가 일치하지 않습니다.`);
  if (roleMismatch.length) output.push(`${roleMismatch.length} task correlation에서 agent role이 다릅니다. Handoff 대상을 확인하세요.`);
  return output;
}

/** All arrays are derived copies. No filter mutates simulation or Supabase data. */
export function applyOperationsLens(
  allTasks: SimTask[], allEvents: SimEvent[], allTraces: AgentTraceRow[], filters: OperationsLensFilters,
): LensResult {
  const session = filters.sessionId.trim();
  const keyword = filters.keyword.trim();

  const tasks = allTasks.filter(task => taskCriteria(task, filters)
    && (filters.traceType === 'all' || allTraces.some(trace => trace.trace_type === filters.traceType && taskMatchesTrace(task, trace))));

  const events = allEvents.filter(event => {
    const linkedTasks = allTasks.filter(task => taskMatchesEvent(task, event));
    return (filters.role === 'all' || event.agentId === filters.role)
      && includes(event.sessionId ?? '', session)
      && includes(eventText(event), keyword)
      && relatedTaskCriteria(linkedTasks, filters)
      && (filters.traceType === 'all' || allTraces.some(trace => trace.trace_type === filters.traceType && eventMatchesTrace(event, trace)));
  });

  const traces = allTraces.filter(trace => {
    const linkedTasks = allTasks.filter(task => taskMatchesTrace(task, trace));
    return (filters.role === 'all' || traceRoleMatches(trace, filters.role))
      && (filters.traceType === 'all' || trace.trace_type === filters.traceType)
      && includes(trace.session_id, session)
      && includes(traceText(trace), keyword)
      && relatedTaskCriteria(linkedTasks, filters);
  });

  return { tasks, events, traces, warnings: warningsFor(tasks, allEvents, allTraces, isLensActive(filters)) };
}

export function matchingTaskTitles(traces: AgentTraceRow[]): string[] {
  return [...new Set(traces.map(traceTaskTitle).filter(Boolean))];
}
