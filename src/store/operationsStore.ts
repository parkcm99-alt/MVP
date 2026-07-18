import { create } from 'zustand';
import type { AgentRole, TaskPriority, TaskStatus } from '@/types';
import type { AgentTraceType } from '@/lib/supabase/traces';

export interface OperationsFilters {
  role: AgentRole | 'all';
  status: TaskStatus | 'all';
  priority: TaskPriority | 'all';
  traceType: AgentTraceType | 'all';
  sessionId: string;
  keyword: string;
}

export const EMPTY_FILTERS: OperationsFilters = {
  role: 'all', status: 'all', priority: 'all', traceType: 'all', sessionId: '', keyword: '',
};

interface OperationsStore {
  filters: OperationsFilters;
  setFilter: <K extends keyof OperationsFilters>(key: K, value: OperationsFilters[K]) => void;
  clearFilters: () => void;
}

export const useOperationsStore = create<OperationsStore>(set => ({
  filters: EMPTY_FILTERS,
  setFilter: (key, value) => set(state => ({ filters: { ...state.filters, [key]: value } })),
  clearFilters: () => set({ filters: { ...EMPTY_FILTERS } }),
}));

export function hasActiveFilters(filters: OperationsFilters): boolean {
  return filters.role !== 'all' || filters.status !== 'all' || filters.priority !== 'all'
    || filters.traceType !== 'all' || Boolean(filters.sessionId.trim() || filters.keyword.trim());
}
