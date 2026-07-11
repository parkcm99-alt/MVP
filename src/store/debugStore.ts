import { create } from 'zustand';
import { getSupabaseConfigStatus } from '@/lib/supabase/client';
import type { LlmProvider } from '@/lib/llm/types';
import { useTraceDebugStore } from '@/store/traceDebugStore';

export type SupabaseDebugStatus = 'mock' | 'misconfigured' | 'connecting' | 'ready' | 'partial' | 'error';

export interface LlmDebugSnapshot {
  role: string | null;
  provider: LlmProvider | null;
  lastPlanAt: number | null;
  traceRecorded: boolean | null;
  model: string | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

interface LlmDebugUpdate {
  role?: string;
  provider: LlmProvider;
  traceRecorded?: boolean | null;
  model?: string | null;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  taskTitle?: string;
  resultStatus?: string;
  recordTrace?: boolean;
}

interface DebugStore {
  supabaseStatus: SupabaseDebugStatus;
  planner: LlmDebugSnapshot;
  setSupabaseStatus: (status: SupabaseDebugStatus) => void;
  recordPlannerResponse: (update: LlmDebugUpdate) => void;
  recordAgentResponse: (update: LlmDebugUpdate) => void;
}

const INITIAL_PLANNER_DEBUG: LlmDebugSnapshot = {
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

  setSupabaseStatus: (supabaseStatus) => set({ supabaseStatus }),

  recordPlannerResponse: (update) => {
    if (update.recordTrace !== false && update.traceRecorded !== true) useTraceDebugStore.getState().addLocalTrace({
      agent_id: 'planner',
      trace_type: 'llm_call',
      model: update.model ?? null,
      latency_ms: update.latencyMs ?? null,
      input_tokens: update.inputTokens ?? null,
      output_tokens: update.outputTokens ?? null,
      metadata: { traceRecorded: update.traceRecorded ?? null, task_title: update.taskTitle },
    });
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
    });
  },
  recordAgentResponse: (update) => {
    if (update.recordTrace !== false && update.traceRecorded !== true) useTraceDebugStore.getState().addLocalTrace({
      agent_id: update.role ?? 'unknown',
      trace_type: 'llm_call',
      model: update.model ?? null,
      latency_ms: update.latencyMs ?? null,
      input_tokens: update.inputTokens ?? null,
      output_tokens: update.outputTokens ?? null,
      metadata: {
        traceRecorded: update.traceRecorded ?? null,
        task_title: update.taskTitle,
        finalStatus: update.resultStatus,
      },
    });
    set({
      planner: {
        role: update.role ?? null,
        provider: update.provider,
        lastPlanAt: Date.now(),
        traceRecorded: update.traceRecorded ?? null,
        model: update.model ?? null,
        latencyMs: update.latencyMs ?? null,
        inputTokens: update.inputTokens ?? null,
        outputTokens: update.outputTokens ?? null,
      },
    });
  },
}));
