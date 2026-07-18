import type { AgentTraceRow } from '@/lib/supabase/types';
import type { LensFilters } from '@/store/lensStore';
import type { SimEvent, SimTask } from '@/types';

function normalized(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

export function includesKeyword(text: string, keyword: string): boolean {
  return !keyword.trim() || normalized(text).includes(normalized(keyword));
}

export function sessionMatches(sessionId: string | undefined, query: string, currentSession: string): boolean {
  return !query.trim() || normalized(sessionId ?? currentSession).includes(normalized(query));
}

export function traceTaskTitle(trace: AgentTraceRow): string {
  const value = trace.metadata?.task_title ?? trace.metadata?.taskTitle;
  return typeof value === 'string' ? value.trim() : '';
}

export function titlesMatch(left: string, right: string): boolean {
  const a = normalized(left);
  const b = normalized(right);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

export function traceRelatesToTask(trace: AgentTraceRow, task: SimTask, currentSession: string): boolean {
  if (normalized(trace.session_id) !== normalized(task.sessionId ?? currentSession)) return false;
  const title = traceTaskTitle(trace);
  // A title is the strongest link. Older traces without one can only be correlated by role.
  return title ? titlesMatch(title, task.title) : Boolean(task.assignedTo && trace.agent_id === task.assignedTo);
}

export function eventRelatesToTask(event: SimEvent, task: SimTask, currentSession: string): boolean {
  if (normalized(event.sessionId ?? currentSession) !== normalized(task.sessionId ?? currentSession)) return false;
  return titlesMatch(event.message, task.title)
    || Boolean(task.assignedTo && event.agentId === task.assignedTo);
}

export function traceRelatesToEvent(trace: AgentTraceRow, event: SimEvent, currentSession: string): boolean {
  if (normalized(trace.session_id) !== normalized(event.sessionId ?? currentSession)) return false;
  const title = traceTaskTitle(trace);
  return (title ? titlesMatch(event.message, title) : false) || trace.agent_id === event.agentId;
}

function taskFacetsMatch(task: SimTask, filters: LensFilters): boolean {
  return (!filters.role || task.assignedTo === filters.role)
    && (!filters.status || task.status === filters.status)
    && (!filters.priority || task.priority === filters.priority);
}

export function matchesTask(
  task: SimTask,
  filters: LensFilters,
  traces: AgentTraceRow[],
  currentSession: string,
): boolean {
  return taskFacetsMatch(task, filters)
    && sessionMatches(task.sessionId, filters.sessionId, currentSession)
    && (!filters.traceType || traces.some(trace => trace.trace_type === filters.traceType
      && traceRelatesToTask(trace, task, currentSession)))
    && includesKeyword(
      `${task.title} ${task.description} ${task.assignedTo ?? ''} ${task.status} ${task.priority}`,
      filters.keyword,
    );
}

export function matchesEvent(
  event: SimEvent,
  filters: LensFilters,
  tasks: SimTask[],
  traces: AgentTraceRow[],
  currentSession: string,
): boolean {
  const hasTaskFacet = Boolean(filters.status || filters.priority);
  return (!filters.role || event.agentId === filters.role)
    && sessionMatches(event.sessionId, filters.sessionId, currentSession)
    && (!hasTaskFacet || tasks.some(task => taskFacetsMatch(task, filters)
      && eventRelatesToTask(event, task, currentSession)))
    && (!filters.traceType || traces.some(trace => trace.trace_type === filters.traceType
      && traceRelatesToEvent(trace, event, currentSession)))
    && includesKeyword(`${event.message} ${event.agentId} ${event.agentName} ${event.type}`, filters.keyword);
}

export function matchesTrace(
  trace: AgentTraceRow,
  filters: LensFilters,
  tasks: SimTask[],
  currentSession: string,
): boolean {
  const hasTaskFacet = Boolean(filters.status || filters.priority);
  return (!filters.role || trace.agent_id === filters.role)
    && (!filters.traceType || trace.trace_type === filters.traceType)
    && sessionMatches(trace.session_id, filters.sessionId, currentSession)
    && (!hasTaskFacet || tasks.some(task => taskFacetsMatch(task, filters)
      && traceRelatesToTask(trace, task, currentSession)))
    && includesKeyword(
      `${trace.agent_id} ${trace.trace_type} ${trace.session_id} ${trace.model ?? ''} ${traceTaskTitle(trace)} ${JSON.stringify(trace.metadata ?? {})}`,
      filters.keyword,
    );
}

export function lensIsActive(filters: LensFilters): boolean {
  return Object.values(filters).some(value => Boolean(value.trim()));
}
