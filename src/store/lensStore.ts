'use client';

import { create } from 'zustand';
import type { AgentTraceType } from '@/lib/supabase/traces';
import type { AgentRole, TaskPriority, TaskStatus } from '@/types';

export interface LensFilters {
  role: AgentRole | '';
  status: TaskStatus | '';
  priority: TaskPriority | '';
  traceType: AgentTraceType | '';
  sessionId: string;
  keyword: string;
}

const EMPTY_FILTERS: LensFilters = { role: '', status: '', priority: '', traceType: '', sessionId: '', keyword: '' };

interface LensStore {
  filters: LensFilters;
  setFilter: <K extends keyof LensFilters>(key: K, value: LensFilters[K]) => void;
  clear: () => void;
}

export const useLensStore = create<LensStore>((set) => ({
  filters: EMPTY_FILTERS,
  setFilter: (key, value) => set(s => ({ filters: { ...s.filters, [key]: value } })),
  clear: () => set({ filters: EMPTY_FILTERS }),
}));
