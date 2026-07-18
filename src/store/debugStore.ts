import { create } from 'zustand';
import { getSupabaseConfigStatus } from '@/lib/supabase/client';
import type { LlmProvider } from '@/lib/llm/types';
import type { AgentRole } from '@/types';

export type SupabaseDebugStatus = 'mock' | 'misconfigured' | 'connecting' | 'ready' | 'partial' | 'error';

interface AgentDebugSnapshot {
  role: AgentRole | null;
  provider: LlmProvider | null;
  lastCallAt: number | null;
  traceRecorded: boolean | null;
  model: string | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

interface AgentDebugUpdate {
  provider: LlmProvider;
  traceRecorded?: boolean | null;
  model?: string | null;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
}

interface DebugStore {
  supabaseStatus: SupabaseDebugStatus;
  lastAgent: AgentDebugSnapshot;
  setSupabaseStatus: (status: SupabaseDebugStatus) => void;
  recordAgentResponse: (role: AgentRole, update: AgentDebugUpdate) => void;
}

const INITIAL_AGENT_DEBUG: AgentDebugSnapshot = {
  role: null,
  provider: null,
  lastCallAt: null,
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
  lastAgent: INITIAL_AGENT_DEBUG,

  setSupabaseStatus: (supabaseStatus) => set({ supabaseStatus }),

  recordAgentResponse: (role, update) =>
    set({
      lastAgent: {
        role,
        provider: update.provider,
        lastCallAt: Date.now(),
        traceRecorded: update.traceRecorded ?? null,
        model: update.model ?? null,
        latencyMs: update.latencyMs ?? null,
        inputTokens: update.inputTokens ?? null,
        outputTokens: update.outputTokens ?? null,
      },
    }),
}));
