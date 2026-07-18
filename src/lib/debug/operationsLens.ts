import type { AgentTraceRow } from '@/lib/supabase/types';
import type { OperationsFilters } from '@/store/operationsStore';
import type { SimEvent, SimTask } from '@/types';
import { eventMatchesTask, eventMatchesTrace, normalizeMatch, summarizeMetadata, taskMatchesTrace, traceTaskTitle } from './correlation';

export interface LensResult {
  tasks: SimTask[];
  events: SimEvent[];
  traces: AgentTraceRow[];
}

function includes(value: string, query: string): boolean {
  return !query || normalizeMatch(value).includes(normalizeMatch(query));
}

function sessionMatches(value: string | undefined, query: string): boolean {
  return !query || (value ?? '').toLowerCase().includes(query.toLowerCase());
}

/** A read-only projection. Correlation bridges filters whose field lives in another panel. */
export function applyOperationsLens(filters: OperationsFilters, allTasks: SimTask[], allEvents: SimEvent[], allTraces: AgentTraceRow[]): LensResult {
  const session = filters.sessionId.trim();
  const keyword = filters.keyword.trim();
  const role = filters.role;

  const tasks = allTasks.filter(task => {
    if (role !== 'all' && task.assignedTo !== role) return false;
    if (filters.status !== 'all' && task.status !== filters.status) return false;
    if (filters.priority !== 'all' && task.priority !== filters.priority) return false;
    if (!sessionMatches(task.sessionId, session)) return false;
    if (!includes(`${task.title} ${task.description} ${task.assignedTo ?? ''} ${task.status} ${task.priority}`, keyword)) return false;
    if (filters.traceType !== 'all' && !allTraces.some(trace => trace.trace_type === filters.traceType && taskMatchesTrace(task, trace))) return false;
    return true;
  });

  const events = allEvents.filter(event => {
    if (role !== 'all' && event.agentId !== role) return false;
    if (!sessionMatches(event.sessionId, session)) return false;
    if (!includes(`${event.message} ${event.agentId} ${event.type}`, keyword)) return false;
    if ((filters.status !== 'all' || filters.priority !== 'all') && !allTasks.some(task =>
      (filters.status === 'all' || task.status === filters.status)
      && (filters.priority === 'all' || task.priority === filters.priority)
      && eventMatchesTask(event, task))) return false;
    if (filters.traceType !== 'all' && !allTraces.some(trace => trace.trace_type === filters.traceType && eventMatchesTrace(event, trace))) return false;
    return true;
  });

  const traces = allTraces.filter(trace => {
    if (role !== 'all' && trace.agent_id !== role
      && trace.metadata?.target_agent !== role && trace.metadata?.source_agent !== role) return false;
    if (filters.traceType !== 'all' && trace.trace_type !== filters.traceType) return false;
    if (!sessionMatches(trace.session_id, session)) return false;
    if (!includes(`${trace.agent_id} ${trace.trace_type} ${trace.model ?? ''} ${traceTaskTitle(trace)} ${summarizeMetadata(trace.metadata)}`, keyword)) return false;
    if ((filters.status !== 'all' || filters.priority !== 'all') && !allTasks.some(task =>
      (filters.status === 'all' || task.status === filters.status)
      && (filters.priority === 'all' || task.priority === filters.priority)
      && taskMatchesTrace(task, trace))) return false;
    return true;
  });
  return { tasks, events, traces };
}

/** Warnings are diagnostics over the projection, never persisted. */
export function getLensWarnings(filters: OperationsFilters, result: LensResult): string[] {
  const warnings: string[] = [];
  const missing = result.tasks.filter(task =>
    !result.events.some(event => eventMatchesTask(event, task))
    && !result.traces.some(trace => taskMatchesTrace(task, trace)));
  if (missing.length) warnings.push(`${missing.length} filtered task(s)에 관련 Event/Trace가 없습니다.`);

  if (filters.sessionId.trim()) {
    if (result.tasks.length && !result.events.length) warnings.push('선택한 session에 task는 있지만 일치하는 event가 없습니다.');
    if ((result.tasks.length || result.events.length) && !result.traces.length) warnings.push('선택한 session에 일치하는 trace가 없습니다 (mock 또는 Refresh 필요).');
  }

  const mismatch = result.traces.filter(trace => result.tasks.some(task => {
    if (!traceTaskTitle(trace) || !taskMatchesTrace(task, trace) || !task.assignedTo) return false;
    const target = trace.metadata?.target_agent;
    return trace.trace_type !== 'handoff' && trace.agent_id !== task.assignedTo
      && target !== task.assignedTo && trace.agent_id !== 'planner';
  }));
  if (mismatch.length) warnings.push(`${mismatch.length} trace(s)의 agent role이 관련 task 담당자와 다릅니다.`);
  return [...new Set(warnings)].slice(0, 4);
}
