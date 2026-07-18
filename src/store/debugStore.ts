import { create } from 'zustand';
import { getSupabaseConfigStatus } from '@/lib/supabase/client';
import { uuid } from '@/lib/supabase/session';
import type { AgentTraceRow } from '@/lib/supabase/types';
import type { LlmProvider } from '@/lib/llm/types';
import type { AgentRole } from '@/types';
import type { AgentInvocation, DebugBundle } from '@/lib/debug/correlation';

export type SupabaseDebugStatus = 'mock' | 'misconfigured' | 'connecting' | 'ready' | 'partial' | 'error';

export interface AgentDebugSnapshot {
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
  role: AgentRole;
  provider: LlmProvider;
  traceRecorded?: boolean | null;
  model?: string | null;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
}

interface DebugStore {
  supabaseStatus: SupabaseDebugStatus;
  latest: AgentDebugSnapshot;
  remoteTraces: AgentTraceRow[];
  localTraces: AgentTraceRow[];
  invocations: AgentInvocation[];
  selectedSessionId: string | null;
  importedBundle: DebugBundle | null;
  findingSignatures: string[];
  setSupabaseStatus: (status: SupabaseDebugStatus) => void;
  recordAgentResponse: (update: AgentDebugUpdate) => void;
  setRemoteTraces: (traces: AgentTraceRow[]) => void;
  addLocalTrace: (trace: Omit<AgentTraceRow, 'id' | 'created_at'>) => void;
  beginInvocation: (value: Omit<AgentInvocation, 'id' | 'completedAt' | 'provider' | 'traceRecorded'>) => string;
  completeInvocation: (id: string, provider: LlmProvider | null, traceRecorded: boolean | null) => void;
  selectSession: (id: string | null) => void;
  setImportedBundle: (bundle: DebugBundle | null) => void;
  markFinding: (signature: string) => void;
  resetRuntime: () => void;
}

const INITIAL_LATEST: AgentDebugSnapshot = {
  role: null, provider: null, lastCallAt: null, traceRecorded: null,
  model: null, latencyMs: null, inputTokens: null, outputTokens: null,
};

export const useDebugStore = create<DebugStore>(set => ({
  supabaseStatus: getSupabaseConfigStatus() === 'ready'
    ? 'connecting' : getSupabaseConfigStatus() === 'missing' ? 'mock' : 'misconfigured',
  latest: INITIAL_LATEST,
  remoteTraces: [], localTraces: [], invocations: [], selectedSessionId: null, importedBundle: null, findingSignatures: [],

  setSupabaseStatus: supabaseStatus => set({ supabaseStatus }),
  recordAgentResponse: update => set({ latest: {
    role: update.role, provider: update.provider, lastCallAt: Date.now(),
    traceRecorded: update.traceRecorded ?? null, model: update.model ?? null,
    latencyMs: update.latencyMs ?? null, inputTokens: update.inputTokens ?? null, outputTokens: update.outputTokens ?? null,
  } }),
  setRemoteTraces: remoteTraces => set({ remoteTraces: remoteTraces.slice(0, 100) }),
  addLocalTrace: trace => set(state => ({ localTraces: [
    { ...trace, id: uuid(), created_at: new Date().toISOString() }, ...state.localTraces,
  ].slice(0, 100) })),
  beginInvocation: value => {
    const id = uuid();
    set(state => ({ invocations: [{ ...value, id, completedAt: null, provider: null, traceRecorded: null }, ...state.invocations].slice(0, 100) }));
    return id;
  },
  completeInvocation: (id, provider, traceRecorded) => set(state => ({
    invocations: state.invocations.map(item => item.id === id ? { ...item, completedAt: Date.now(), provider, traceRecorded } : item),
  })),
  selectSession: selectedSessionId => set({ selectedSessionId }),
  setImportedBundle: importedBundle => set({ importedBundle, selectedSessionId: importedBundle?.sessionId ?? null }),
  markFinding: signature => set(state => ({ findingSignatures: [...new Set([...state.findingSignatures, signature])] })),
  resetRuntime: () => set({ latest: INITIAL_LATEST, remoteTraces: [], localTraces: [], invocations: [], selectedSessionId: null, importedBundle: null, findingSignatures: [] }),
}));
