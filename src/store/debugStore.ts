import { create } from 'zustand';
import { getSupabaseConfigStatus } from '@/lib/supabase/client';
import type { LlmProvider } from '@/lib/llm/types';

export type SupabaseDebugStatus = 'mock' | 'misconfigured' | 'connecting' | 'ready' | 'partial' | 'error';

interface PlannerDebugSnapshot {
  role: string | null;
  provider: LlmProvider | null;
  lastPlanAt: number | null;
  traceRecorded: boolean | null;
  model: string | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

interface PlannerDebugUpdate {
  role?: string;
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
  setSupabaseStatus: (status: SupabaseDebugStatus) => void;
  recordPlannerResponse: (update: PlannerDebugUpdate) => void;
  highlightedTaskTitle: string | null;
  setHighlightedTaskTitle: (title: string | null) => void;
  lens: { role:string; status:string; priority:string; traceType:string; sessionId:string; keyword:string };
  setLens: (patch: Partial<DebugStore['lens']>) => void;
  clearLens: () => void;
}

const INITIAL_PLANNER_DEBUG: PlannerDebugSnapshot = {
  role: null,
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
  highlightedTaskTitle: null,
  setHighlightedTaskTitle: (highlightedTaskTitle) => set({ highlightedTaskTitle }),
  lens: { role:'', status:'', priority:'', traceType:'', sessionId:'', keyword:'' },
  setLens: (patch) => set(s => ({ lens: { ...s.lens, ...patch } })),
  clearLens: () => set({ lens: { role:'', status:'', priority:'', traceType:'', sessionId:'', keyword:'' } }),

  setSupabaseStatus: (supabaseStatus) => set({ supabaseStatus }),

  recordPlannerResponse: (update) =>
    set({
      planner: {
        role: update.role ?? 'planner',
        provider: update.provider,
        lastPlanAt: Date.now(),
        traceRecorded: update.traceRecorded ?? null,
        model: update.model ?? null,
        latencyMs: update.latencyMs ?? null,
        inputTokens: update.inputTokens ?? null,
        outputTokens: update.outputTokens ?? null,
      },
    }),
}));
