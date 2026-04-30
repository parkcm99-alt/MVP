import { create } from 'zustand';
import { getSupabaseConfigStatus } from '@/lib/supabase/client';
import type { LlmProvider } from '@/lib/llm/types';

export type SupabaseDebugStatus = 'mock' | 'misconfigured' | 'connecting' | 'ready' | 'partial' | 'error';

interface PlannerDebugSnapshot {
  provider: LlmProvider | null;
  lastPlanAt: number | null;
  traceRecorded: boolean | null;
  model: string | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

interface PlannerDebugUpdate {
  provider: LlmProvider;
  traceRecorded?: boolean | null;
  model?: string | null;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
}

interface DebugStore {
  supabaseStatus: SupabaseDebugStatus;
  planner: PlannerDebugSnapshot;
  traceRefreshAt: number | null;
  setSupabaseStatus: (status: SupabaseDebugStatus) => void;
  recordPlannerResponse: (update: PlannerDebugUpdate) => void;
  refreshTraces: () => void;
}

const INITIAL_PLANNER_DEBUG: PlannerDebugSnapshot = {
  provider: null,
  lastPlanAt: null,
  traceRecorded: null,
  model: null,
  latencyMs: null,
  inputTokens: null,
  outputTokens: null,
};

export const useDebugStore = create<DebugStore>((set) => ({
  supabaseStatus: getSupabaseConfigStatus() === 'ready'
    ? 'connecting'
    : getSupabaseConfigStatus() === 'missing' ? 'mock' : 'misconfigured',
  planner: INITIAL_PLANNER_DEBUG,
  traceRefreshAt: null,

  setSupabaseStatus: (supabaseStatus) => set({ supabaseStatus }),

  recordPlannerResponse: (update) =>
    set({
      planner: {
        provider: update.provider,
        lastPlanAt: Date.now(),
        traceRecorded: update.traceRecorded ?? null,
        model: update.model ?? null,
        latencyMs: update.latencyMs ?? null,
        inputTokens: update.inputTokens ?? null,
        outputTokens: update.outputTokens ?? null,
      },
    }),

  refreshTraces: () => set({ traceRefreshAt: Date.now() }),
}));
