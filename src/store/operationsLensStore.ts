import { create } from 'zustand';

export interface OperationsLensFilters {
  agentRole: string;
  taskStatus: string;
  priority: string;
  traceType: string;
  sessionId: string;
  keyword: string;
}

const EMPTY: OperationsLensFilters = {
  agentRole: '',
  taskStatus: '',
  priority: '',
  traceType: '',
  sessionId: '',
  keyword: '',
};

interface OperationsLensStore extends OperationsLensFilters {
  setFilter: (key: keyof OperationsLensFilters, value: string) => void;
  clearAll: () => void;
}

export const useOperationsLensStore = create<OperationsLensStore>(set => ({
  ...EMPTY,
  setFilter: (key, value) => set({ [key]: value }),
  clearAll: () => set(EMPTY),
}));

export function textMatches(keyword: string, ...values: unknown[]): boolean {
  const needle = keyword.trim().toLowerCase();
  return !needle || values.some(value => String(value ?? '').toLowerCase().includes(needle));
}
