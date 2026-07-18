import { create } from 'zustand';
import type { AgentTraceRow } from '@/lib/supabase/types';
import type { AgentRole, TaskPriority, TaskStatus } from '@/types';

export interface LensFilters {
  role: AgentRole | 'all';
  status: TaskStatus | 'all';
  priority: TaskPriority | 'all';
  traceType: 'llm_call' | 'handoff' | 'decision' | 'tool_use' | 'all';
  sessionId: string;
  keyword: string;
}

export const INITIAL_FILTERS: LensFilters = {
  role: 'all', status: 'all', priority: 'all', traceType: 'all', sessionId: '', keyword: '',
};

interface OperationsStore {
  filters: LensFilters;
  traces: AgentTraceRow[];
  selectedSessionId: string | null;
  highlightedTaskTitles: string[];
  readOnlyAnalysis: boolean;
  revision: number;
  setFilter: <K extends keyof LensFilters>(key: K, value: LensFilters[K]) => void;
  clearFilters: () => void;
  setTraces: (traces: AgentTraceRow[]) => void;
  selectSession: (sessionId: string | null, taskTitles?: string[]) => void;
  setReadOnlyAnalysis: (value: boolean) => void;
  refreshContext: () => void;
}

export const useOperationsStore = create<OperationsStore>(set => ({
  filters: INITIAL_FILTERS,
  traces: [],
  selectedSessionId: null,
  highlightedTaskTitles: [],
  readOnlyAnalysis: false,
  revision: 0,
  setFilter: (key, value) => set(state => ({ filters: { ...state.filters, [key]: value } })),
  clearFilters: () => set({ filters: INITIAL_FILTERS }),
  setTraces: traces => set({ traces }),
  selectSession: (selectedSessionId, highlightedTaskTitles = []) => set({ selectedSessionId, highlightedTaskTitles }),
  setReadOnlyAnalysis: readOnlyAnalysis => set({ readOnlyAnalysis }),
  refreshContext: () => set(state => ({ revision: state.revision + 1 })),
}));
