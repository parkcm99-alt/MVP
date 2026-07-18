import type { AgentTraceRow } from '@/lib/supabase/types';
import type { LensFilters } from '@/store/lensStore';
import type { SimEvent, SimTask } from '@/types';

export interface LensResult {
  tasks: SimTask[];
  events: SimEvent[];
  traces: AgentTraceRow[];
  warnings: string[];
}

const norm = (value: unknown): string => typeof value === 'string'
  ? value.trim().toLowerCase().replace(/\s+/g, ' ')
  : '';

const includes = (value: unknown, query: string): boolean => norm(value).includes(norm(query));

export function traceTaskTitle(trace: AgentTraceRow): string {
  const metadata = trace.metadata ?? {};
  return typeof metadata.task_title === 'string'
    ? metadata.task_title
    : typeof metadata.taskTitle === 'string' ? metadata.taskTitle : '';
}

function eventTaskTitle(event: SimEvent): string {
  const metadata = event.metadata ?? {};
  for (const key of ['task_title', 'taskTitle', 'task', 'title']) {
    if (typeof metadata[key] === 'string') return metadata[key] as string;
  }
  return '';
}

function sameTitle(a: string, b: string): boolean {
  return Boolean(norm(a) && norm(a) === norm(b));
}

export function taskMatchesTrace(task: SimTask, trace: AgentTraceRow): boolean {
  const title = traceTaskTitle(trace);
  if (title) return sameTitle(task.title, title);
  return Boolean(task.sessionId === trace.session_id && task.assignedTo === trace.agent_id);
}

export function taskMatchesEvent(task: SimTask, event: SimEvent): boolean {
  const title = eventTaskTitle(event);
  if (title) return sameTitle(task.title, title);
  if (includes(event.message, task.title)) return true;
  return Boolean(task.sessionId === event.sessionId && task.assignedTo === event.agentId);
}

function eventMatchesTrace(event: SimEvent, trace: AgentTraceRow, tasks: SimTask[]): boolean {
  const eventTitle = eventTaskTitle(event);
  const traceTitle = traceTaskTitle(trace);
  if (eventTitle && traceTitle) return sameTitle(eventTitle, traceTitle);
  if (traceTitle && includes(event.message, traceTitle)) return true;
  if (tasks.some(task => taskMatchesEvent(task, event) && taskMatchesTrace(task, trace))) return true;
  return Boolean(event.sessionId === trace.session_id && event.agentId === trace.agent_id);
}

function taskText(task: SimTask): string {
  return [task.title, task.description, task.assignedTo, task.status, task.priority, task.sessionId].join(' ');
}

function eventText(event: SimEvent): string {
  return [event.message, event.agentId, event.type, event.sessionId, eventTaskTitle(event)].join(' ');
}

function traceText(trace: AgentTraceRow): string {
  return [trace.agent_id, trace.trace_type, trace.model, trace.session_id, traceTaskTitle(trace),
    ...Object.entries(trace.metadata ?? {})
      .filter(([key]) => !/api|auth|credential|key|password|secret|token/i.test(key))
      .map(([, value]) => typeof value === 'string' || typeof value === 'number' ? String(value) : ''),
  ].join(' ');
}

export function hasActiveLens(filters: LensFilters): boolean {
  return filters.role !== 'all' || filters.taskStatus !== 'all' || filters.priority !== 'all'
    || filters.traceType !== 'all' || Boolean(filters.sessionId.trim() || filters.keyword.trim());
}

/** Read-only projection: none of the input arrays or records are mutated. */
export function applyOperationsLens(
  filters: LensFilters,
  tasks: SimTask[],
  events: SimEvent[],
  traces: AgentTraceRow[],
): LensResult {
  const session = filters.sessionId.trim();
  const keyword = filters.keyword.trim();

  const filteredTasks = tasks.filter(task => (
    (filters.role === 'all' || task.assignedTo === filters.role)
    && (filters.taskStatus === 'all' || task.status === filters.taskStatus)
    && (filters.priority === 'all' || task.priority === filters.priority)
    && (!session || includes(task.sessionId, session))
    && (!keyword || includes(taskText(task), keyword))
    && (filters.traceType === 'all' || traces.some(trace =>
      trace.trace_type === filters.traceType && taskMatchesTrace(task, trace)))
  ));

  const filteredEvents = events.filter(event => {
    const relatedTasks = tasks.filter(task => taskMatchesEvent(task, event));
    return (filters.role === 'all' || event.agentId === filters.role)
      && (!session || includes(event.sessionId, session))
      && (!keyword || includes(eventText(event), keyword))
      && (filters.taskStatus === 'all' || relatedTasks.some(task => task.status === filters.taskStatus)
        || event.metadata?.status === filters.taskStatus)
      && (filters.priority === 'all' || relatedTasks.some(task => task.priority === filters.priority)
        || event.metadata?.taskPriority === filters.priority)
      && (filters.traceType === 'all' || traces.some(trace =>
        trace.trace_type === filters.traceType && eventMatchesTrace(event, trace, tasks)));
  });

  const filteredTraces = traces.filter(trace => {
    const relatedTasks = tasks.filter(task => taskMatchesTrace(task, trace));
    return (filters.role === 'all' || trace.agent_id === filters.role)
      && (filters.traceType === 'all' || trace.trace_type === filters.traceType)
      && (!session || includes(trace.session_id, session))
      && (!keyword || includes(traceText(trace), keyword))
      && (filters.taskStatus === 'all' || relatedTasks.some(task => task.status === filters.taskStatus)
        || trace.metadata?.status === filters.taskStatus)
      && (filters.priority === 'all' || relatedTasks.some(task => task.priority === filters.priority));
  });

  const warnings: string[] = [];
  if (hasActiveLens(filters)) {
    for (const task of filteredTasks.slice(0, 12)) {
      const relatedEvents = events.filter(event => taskMatchesEvent(task, event));
      const relatedTraces = traces.filter(trace => taskMatchesTrace(task, trace));
      const label = task.title.slice(0, 32);
      if (!relatedEvents.length) warnings.push(`Task “${label}” has no related event.`);
      if (!relatedTraces.length) warnings.push(`Task “${label}” has no related trace.`);
      if (task.sessionId && relatedTraces.some(trace => trace.session_id !== task.sessionId)) {
        warnings.push(`Session mismatch near task “${label}”.`);
      }
      if (task.assignedTo && relatedTraces.some(trace => {
        if (trace.trace_type === 'handoff') return trace.metadata?.target_agent !== task.assignedTo;
        return trace.agent_id !== task.assignedTo;
      })) {
        warnings.push(`Agent role mismatch near task “${label}”.`);
      }
    }
  }

  return {
    tasks: filteredTasks,
    events: filteredEvents,
    traces: filteredTraces,
    warnings: [...new Set(warnings)].slice(0, 6),
  };
}
