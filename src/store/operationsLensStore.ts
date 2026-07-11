import { create } from 'zustand';
import type { AgentTraceRow } from '@/lib/supabase/types';
import type { SimEvent, SimTask } from '@/types';

export interface LensFilters {
  role: string;
  status: string;
  priority: string;
  traceType: string;
  sessionId: string;
  keyword: string;
}

const EMPTY: LensFilters = {
  role: '',
  status: '',
  priority: '',
  traceType: '',
  sessionId: '',
  keyword: '',
};

interface OperationsLensState {
  filters: LensFilters;
  traceRows: AgentTraceRow[];
  set: (patch: Partial<LensFilters>) => void;
  clear: () => void;
  setTraceRows: (rows: AgentTraceRow[]) => void;
  clearRuntime: () => void;
}

export const useOperationsLens = create<OperationsLensState>(set => ({
  filters: { ...EMPTY },
  traceRows: [],
  set: patch => set(state => ({ filters: { ...state.filters, ...patch } })),
  clear: () => set({ filters: { ...EMPTY } }),
  setTraceRows: traceRows => set({ traceRows }),
  clearRuntime: () => set({ filters: { ...EMPTY }, traceRows: [] }),
}));

export function textMatch(text: string, keyword: string): boolean {
  return !keyword.trim() || text.toLocaleLowerCase().includes(keyword.trim().toLocaleLowerCase());
}

export function traceTaskTitle(trace: AgentTraceRow): string {
  const value = trace.metadata?.task_title ?? trace.metadata?.taskTitle;
  return typeof value === 'string' ? value : '';
}

function relatedTraces(task: SimTask, traces: AgentTraceRow[]): AgentTraceRow[] {
  return traces.filter(trace => traceTaskTitle(trace) === task.title);
}

export function taskMatchesLens(task: SimTask, filters: LensFilters, traces: AgentTraceRow[]): boolean {
  if (filters.role && task.assignedTo !== filters.role) return false;
  if (filters.status && task.status !== filters.status) return false;
  if (filters.priority && task.priority !== filters.priority) return false;
  if (!textMatch(`${task.title} ${task.description} ${task.assignedTo ?? ''} ${task.status} ${task.priority}`, filters.keyword)) return false;

  const linked = relatedTraces(task, traces);
  if (filters.traceType && !linked.some(trace => trace.trace_type === filters.traceType)) return false;
  if (filters.sessionId && !linked.some(trace => trace.session_id === filters.sessionId.trim())) return false;
  return true;
}

export function traceMatchesLens(trace: AgentTraceRow, filters: LensFilters, tasks: SimTask[]): boolean {
  const task = tasks.find(candidate => candidate.title === traceTaskTitle(trace));
  if (filters.role && trace.agent_id !== filters.role) return false;
  if (filters.traceType && trace.trace_type !== filters.traceType) return false;
  if (filters.sessionId && trace.session_id !== filters.sessionId.trim()) return false;
  if (filters.status && task?.status !== filters.status) return false;
  if (filters.priority && task?.priority !== filters.priority) return false;
  return textMatch(
    `${trace.agent_id} ${trace.trace_type} ${trace.session_id} ${traceTaskTitle(trace)} ${trace.model ?? ''} ${JSON.stringify(trace.metadata ?? {})}`,
    filters.keyword,
  );
}

export function eventMatchesLens(
  event: SimEvent,
  filters: LensFilters,
  tasks: SimTask[],
  traces: AgentTraceRow[],
): boolean {
  if (filters.role && event.agentId !== filters.role) return false;
  if (!textMatch(`${event.message} ${event.agentId} ${event.agentName} ${event.type}`, filters.keyword)) return false;

  const linkedTasks = tasks.filter(task => event.message.includes(task.title));
  if (filters.status && !linkedTasks.some(task => task.status === filters.status)) return false;
  if (filters.priority && !linkedTasks.some(task => task.priority === filters.priority)) return false;

  const linkedTraces = traces.filter(trace =>
    linkedTasks.some(task => task.title === traceTaskTitle(trace))
    || event.message.includes(traceTaskTitle(trace)),
  );
  if (filters.traceType && !linkedTraces.some(trace => trace.trace_type === filters.traceType)) return false;
  if (filters.sessionId && !linkedTraces.some(trace => trace.session_id === filters.sessionId.trim())) return false;
  return true;
}

export function highlightParts(text: string, keyword: string): Array<{ text: string; match: boolean }> {
  const needle = keyword.trim();
  if (!needle) return [{ text, match: false }];
  const lower = text.toLocaleLowerCase();
  const target = needle.toLocaleLowerCase();
  const parts: Array<{ text: string; match: boolean }> = [];
  let cursor = 0;
  for (;;) {
    const index = lower.indexOf(target, cursor);
    if (index < 0) break;
    if (index > cursor) parts.push({ text: text.slice(cursor, index), match: false });
    parts.push({ text: text.slice(index, index + needle.length), match: true });
    cursor = index + needle.length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), match: false });
  return parts.length ? parts : [{ text, match: false }];
}
