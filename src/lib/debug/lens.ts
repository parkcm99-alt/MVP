import { safeMetadataText } from '@/lib/debug/sanitize';
import type { LensFilters } from '@/store/lensStore';
import type { AgentTraceRow } from '@/lib/supabase/types';
import type { SimEvent, SimTask } from '@/types';

function norm(value: string): string { return value.trim().toLowerCase().replace(/\s+/g, ' '); }
function includes(haystack: string, needle: string): boolean { return norm(haystack).includes(norm(needle)); }
function sessionMatches(value: string | undefined, filter: string, currentSession: string): boolean {
  return !filter.trim() || includes(value ?? currentSession, filter);
}

export function getTraceTaskTitle(trace: AgentTraceRow): string {
  const value = trace.metadata?.task_title ?? trace.metadata?.taskTitle;
  return typeof value === 'string' ? value : '';
}

export function relatedTaskTrace(task: SimTask, trace: AgentTraceRow): boolean {
  const traceTitle = getTraceTaskTitle(trace);
  if (!traceTitle) return false;
  const a = norm(task.title);
  const b = norm(traceTitle);
  return a === b || (a.length > 5 && b.includes(a)) || (b.length > 5 && a.includes(b));
}

export function relatedTaskEvent(task: SimTask, event: SimEvent): boolean {
  const title = norm(task.title);
  return title.length > 2 && norm(event.message).includes(title);
}

export function relatedEventTrace(event: SimEvent, trace: AgentTraceRow): boolean {
  const title = getTraceTaskTitle(trace);
  if (title && includes(event.message, title)) return true;
  const sameAgent = event.agentId === trace.agent_id;
  const sameSession = !event.sessionId || event.sessionId === trace.session_id;
  const traceAt = Date.parse(trace.created_at);
  return sameAgent && sameSession && Number.isFinite(traceAt) && Math.abs(event.timestamp - traceAt) < 30_000;
}

function traceHasRole(trace: AgentTraceRow, role: string): boolean {
  return trace.agent_id === role || trace.metadata?.source_agent === role || trace.metadata?.target_agent === role || trace.metadata?.assigned_to === role;
}

export function hasActiveFilters(filters: LensFilters): boolean {
  return Object.values(filters).some(value => Boolean(value.trim()));
}

export function filterTasks(tasks: SimTask[], traces: AgentTraceRow[], filters: LensFilters, currentSession: string): SimTask[] {
  return tasks.filter(task => {
    if (filters.role && task.assignedTo !== filters.role) return false;
    if (filters.status && task.status !== filters.status) return false;
    if (filters.priority && task.priority !== filters.priority) return false;
    if (!sessionMatches(task.sessionId, filters.sessionId, currentSession)) return false;
    if (filters.traceType && !traces.some(trace => trace.trace_type === filters.traceType && relatedTaskTrace(task, trace))) return false;
    return !filters.keyword || includes(`${task.title} ${task.description} ${task.assignedTo ?? ''} ${task.status} ${task.priority}`, filters.keyword);
  });
}

export function filterEvents(events: SimEvent[], tasks: SimTask[], traces: AgentTraceRow[], filters: LensFilters, currentSession: string): SimEvent[] {
  return events.filter(event => {
    if (filters.role && event.agentId !== filters.role) return false;
    if (!sessionMatches(event.sessionId, filters.sessionId, currentSession)) return false;
    if ((filters.status || filters.priority) && !tasks.some(task =>
      relatedTaskEvent(task, event) && (!filters.status || task.status === filters.status) && (!filters.priority || task.priority === filters.priority))) return false;
    if (filters.traceType && !traces.some(trace => trace.trace_type === filters.traceType && relatedEventTrace(event, trace))) return false;
    return !filters.keyword || includes(`${event.message} ${event.agentId} ${event.type}`, filters.keyword);
  });
}

export function filterTraces(traces: AgentTraceRow[], tasks: SimTask[], filters: LensFilters): AgentTraceRow[] {
  return traces.filter(trace => {
    if (filters.role && !traceHasRole(trace, filters.role)) return false;
    if (filters.traceType && trace.trace_type !== filters.traceType) return false;
    if (filters.sessionId && !includes(trace.session_id, filters.sessionId)) return false;
    if ((filters.status || filters.priority) && !tasks.some(task =>
      relatedTaskTrace(task, trace) && (!filters.status || task.status === filters.status) && (!filters.priority || task.priority === filters.priority))) return false;
    return !filters.keyword || includes(`${trace.agent_id} ${trace.trace_type} ${trace.session_id} ${trace.model ?? ''} ${safeMetadataText(trace.metadata)}`, filters.keyword);
  });
}

export function buildLensWarnings(tasks: SimTask[], events: SimEvent[], traces: AgentTraceRow[], filters: LensFilters, currentSession: string): string[] {
  if (!hasActiveFilters(filters)) return [];
  const warnings: string[] = [];
  for (const task of tasks) {
    const taskTraces = traces.filter(trace => relatedTaskTrace(task, trace));
    if (!events.some(event => relatedTaskEvent(task, event)) && taskTraces.length === 0) {
      warnings.push(`“${task.title.slice(0, 32)}” has no correlated event or trace. Check session/filter scope.`);
    }
    if (taskTraces.some(trace => trace.session_id !== (task.sessionId ?? currentSession))) {
      warnings.push(`“${task.title.slice(0, 32)}” has a trace in another session. Verify the selected session.`);
    }
    if (task.assignedTo && taskTraces.some(trace => trace.trace_type !== 'handoff' && !traceHasRole(trace, task.assignedTo!))) {
      warnings.push(`“${task.title.slice(0, 32)}” has an agent role mismatch. Check the handoff target.`);
    }
    if (warnings.length >= 6) break;
  }
  return [...new Set(warnings)].slice(0, 6);
}
