import { create } from 'zustand';
import type { AgentRole, TaskPriority, TaskStatus } from '@/types';
import type { AgentTraceType } from '@/lib/supabase/traces';

export interface LensFilters {
  role: AgentRole | 'all';
  taskStatus: TaskStatus | 'all';
  priority: TaskPriority | 'all';
  traceType: AgentTraceType | 'all';
  sessionId: string;
  keyword: string;
}

export const EMPTY_LENS: LensFilters = {
  role: 'all',
  taskStatus: 'all',
  priority: 'all',
  traceType: 'all',
  sessionId: '',
  keyword: '',
};

interface LensStore {
  filters: LensFilters;
  setFilter: <K extends keyof LensFilters>(key: K, value: LensFilters[K]) => void;
  clear: () => void;
}

export const useLensStore = create<LensStore>(set => ({
  filters: EMPTY_LENS,
  setFilter: (key, value) => set(state => ({ filters: { ...state.filters, [key]: value } })),
  clear: () => set({ filters: { ...EMPTY_LENS } }),
}));
