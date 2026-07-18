import type { AgentTraceRow } from '@/lib/supabase/types';
import type { LensFilters } from '@/store/operationsStore';
import type { SimEvent, SimTask } from '@/types';
import { sanitizeRecord } from './sanitize';

function normalize(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function contains(value: unknown, query: string): boolean {
  return normalize(value).includes(normalize(query));
}

export function traceTaskTitle(trace: AgentTraceRow): string {
  const metadata = trace.metadata ?? {};
  const value = metadata.task_title ?? metadata.taskTitle ?? metadata.task;
  return typeof value === 'string' ? value : '';
}

function eventTaskReference(event: SimEvent): string {
  const metadata = event.metadata ?? {};
  const value = metadata.task_title ?? metadata.taskTitle ?? metadata.task ?? metadata.title;
  return typeof value === 'string' ? value : '';
}

function sameSession(a?: string | null, b?: string | null): boolean {
  return !a || !b || a === b;
}

function titlesOverlap(a: string, b: string): boolean {
  const left = normalize(a);
  const right = normalize(b);
  return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)));
}

export function isTraceForTask(trace: AgentTraceRow, task: SimTask, ignoreSession = false): boolean {
  return (ignoreSession || sameSession(trace.session_id, task.sessionId))
    && titlesOverlap(traceTaskTitle(trace), task.title);
}

export function isEventForTask(event: SimEvent, task: SimTask, ignoreSession = false): boolean {
  return (ignoreSession || sameSession(event.sessionId, task.sessionId))
    && (titlesOverlap(eventTaskReference(event), task.title) || contains(event.message, task.title));
}

function traceRoleMatches(trace: AgentTraceRow, role: LensFilters['role']): boolean {
  if (role === 'all' || trace.agent_id === role) return true;
  const metadata = trace.metadata ?? {};
  return [metadata.source_agent, metadata.target_agent, metadata.assigned_to].some(value => value === role);
}

function traceSearchText(trace: AgentTraceRow): string {
  return [
    trace.trace_type,
    trace.agent_id,
    trace.model,
    trace.session_id,
    JSON.stringify(sanitizeRecord(trace.metadata)),
  ].join(' ');
}

export function hasActiveFilters(filters: LensFilters): boolean {
  return filters.role !== 'all'
    || filters.status !== 'all'
    || filters.priority !== 'all'
    || filters.traceType !== 'all'
    || Boolean(filters.sessionId.trim() || filters.keyword.trim());
}

export function filterTasks(tasks: SimTask[], traces: AgentTraceRow[], filters: LensFilters): SimTask[] {
  return tasks.filter(task => {
    if (filters.role !== 'all' && task.assignedTo !== filters.role) return false;
    if (filters.status !== 'all' && task.status !== filters.status) return false;
    if (filters.priority !== 'all' && task.priority !== filters.priority) return false;
    if (filters.sessionId.trim() && !contains(task.sessionId, filters.sessionId)) return false;
    if (filters.keyword.trim() && !contains(`${task.title} ${task.description} ${task.assignedTo ?? ''}`, filters.keyword)) return false;
    if (filters.traceType !== 'all' && !traces.some(trace => trace.trace_type === filters.traceType && isTraceForTask(trace, task))) return false;
    return true;
  });
}

export function filterEvents(
  events: SimEvent[],
  tasks: SimTask[],
  traces: AgentTraceRow[],
  filters: LensFilters,
): SimEvent[] {
  return events.filter(event => {
    if (filters.role !== 'all' && event.agentId !== filters.role) return false;
    if (filters.sessionId.trim() && !contains(event.sessionId, filters.sessionId)) return false;
    if (filters.keyword.trim() && !contains(`${event.message} ${event.type} ${event.agentName} ${eventTaskReference(event)}`, filters.keyword)) return false;
    const relatedTasks = tasks.filter(task => isEventForTask(event, task));
    if (filters.status !== 'all' && !relatedTasks.some(task => task.status === filters.status)) return false;
    if (filters.priority !== 'all' && !relatedTasks.some(task => task.priority === filters.priority)) return false;
    if (filters.traceType !== 'all' && !traces.some(trace =>
      trace.trace_type === filters.traceType
      && sameSession(trace.session_id, event.sessionId)
      && (titlesOverlap(traceTaskTitle(trace), eventTaskReference(event)) || contains(event.message, traceTaskTitle(trace))),
    )) return false;
    return true;
  });
}

export function filterTraces(traces: AgentTraceRow[], tasks: SimTask[], filters: LensFilters): AgentTraceRow[] {
  return traces.filter(trace => {
    if (!traceRoleMatches(trace, filters.role)) return false;
    if (filters.traceType !== 'all' && trace.trace_type !== filters.traceType) return false;
    if (filters.sessionId.trim() && !contains(trace.session_id, filters.sessionId)) return false;
    if (filters.keyword.trim() && !contains(traceSearchText(trace), filters.keyword)) return false;
    const relatedTasks = tasks.filter(task => isTraceForTask(trace, task));
    if (filters.status !== 'all' && !relatedTasks.some(task => task.status === filters.status)) return false;
    if (filters.priority !== 'all' && !relatedTasks.some(task => task.priority === filters.priority)) return false;
    return true;
  });
}

/** Read-only consistency hints; counts avoid leaking arbitrary metadata. */
export function buildLensWarnings(
  tasks: SimTask[],
  events: SimEvent[],
  traces: AgentTraceRow[],
  filters: LensFilters,
): string[] {
  if (!hasActiveFilters(filters)) return [];
  const visibleTasks = filterTasks(tasks, traces, filters);
  const visibleEvents = filterEvents(events, tasks, traces, filters);
  const visibleTraces = filterTraces(traces, tasks, filters);
  const warnings: string[] = [];

  const missingContext = visibleTasks.filter(task =>
    !visibleEvents.some(event => isEventForTask(event, task))
    && !visibleTraces.some(trace => isTraceForTask(trace, task)),
  ).length;
  if (missingContext) warnings.push(`${missingContext} filtered task(s) have no matching event or trace in this view.`);

  const sessionMismatch = visibleTasks.filter(task =>
    traces.some(trace => isTraceForTask(trace, task, true) && !sameSession(trace.session_id, task.sessionId))
    || events.some(event => isEventForTask(event, task, true) && !sameSession(event.sessionId, task.sessionId)),
  ).length;
  if (sessionMismatch) warnings.push(`${sessionMismatch} task correlation(s) reference a different session.`);

  const roleMismatch = visibleTasks.filter(task => task.assignedTo && visibleTraces.some(trace =>
    isTraceForTask(trace, task)
    && trace.trace_type !== 'handoff'
    && trace.agent_id !== task.assignedTo,
  )).length;
  if (roleMismatch) warnings.push(`${roleMismatch} task correlation(s) have a different agent role.`);

  if (!visibleTasks.length && (visibleEvents.length || visibleTraces.length) && (filters.status !== 'all' || filters.priority !== 'all')) {
    warnings.push('Events or traces remain, but no current task matches the selected status/priority.');
  }
  return warnings.slice(0, 4);
}
