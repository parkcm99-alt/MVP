import { create } from 'zustand';
import { getSupabaseConfigStatus } from '@/lib/supabase/client';
import { EMPTY_LENS_FILTERS, type OperationsLensFilters } from '@/lib/debug/operationsLens';
import type { AgentCallRecord, TraceDebugBundle } from '@/lib/debug/correlation';
import type { AgentTraceRow } from '@/lib/supabase/types';
import type { AgentRole } from '@/types';
import type { LlmProvider } from '@/lib/llm/types';

export type SupabaseDebugStatus = 'mock' | 'misconfigured' | 'connecting' | 'ready' | 'partial' | 'error';

interface AgentDebugSnapshot {
  role: AgentRole | null;
  provider: LlmProvider | null;
  lastCallAt: number | null;
  lastPlanAt: number | null;
  traceRecorded: boolean | null;
  model: string | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface AgentDebugUpdate {
  provider: LlmProvider;
  traceRecorded?: boolean | null;
  model?: string | null;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  failed?: boolean;
}

interface DebugStore {
  supabaseStatus: SupabaseDebugStatus;
  latest: AgentDebugSnapshot;
  calls: AgentCallRecord[];
  localTraces: AgentTraceRow[];
  remoteTraces: AgentTraceRow[];
  selectedSessionId: string | null;
  importedBundle: TraceDebugBundle | null;
  filters: OperationsLensFilters;
  findingSignatures: string[];
  setSupabaseStatus: (status: SupabaseDebugStatus) => void;
  startAgentCall: (record: AgentCallRecord) => void;
  recordAgentResponse: (id: string, role: AgentRole, update: AgentDebugUpdate) => void;
  addLocalTrace: (trace: AgentTraceRow) => void;
  setRemoteTraces: (traces: AgentTraceRow[]) => void;
  selectSession: (sessionId: string | null) => void;
  setImportedBundle: (bundle: TraceDebugBundle | null) => void;
  setFilter: <K extends keyof OperationsLensFilters>(key: K, value: OperationsLensFilters[K]) => void;
  clearFilters: () => void;
  markFinding: (signature: string) => void;
  resetLensContext: () => void;
}

const INITIAL_LATEST: AgentDebugSnapshot = {
  role: null, provider: null, lastCallAt: null, lastPlanAt: null,
  traceRecorded: null, model: null, latencyMs: null, inputTokens: null, outputTokens: null,
};

export const useDebugStore = create<DebugStore>((set) => ({
  supabaseStatus: getSupabaseConfigStatus() === 'ready'
    ? 'connecting'
    : getSupabaseConfigStatus() === 'missing' ? 'mock' : 'misconfigured',
  latest: INITIAL_LATEST,
  calls: [],
  localTraces: [],
  remoteTraces: [],
  selectedSessionId: null,
  importedBundle: null,
  filters: { ...EMPTY_LENS_FILTERS },
  findingSignatures: [],

  setSupabaseStatus: (supabaseStatus) => set({ supabaseStatus }),
  startAgentCall: (record) => set(state => ({ calls: [record, ...state.calls].slice(0, 100) })),
  recordAgentResponse: (id, role, update) => set(state => ({
    latest: {
      role,
      provider: update.provider,
      lastCallAt: Date.now(),
      lastPlanAt: role === 'planner' ? Date.now() : state.latest.lastPlanAt,
      traceRecorded: update.traceRecorded ?? null,
      model: update.model ?? null,
      latencyMs: update.latencyMs ?? null,
      inputTokens: update.inputTokens ?? null,
      outputTokens: update.outputTokens ?? null,
    },
    calls: state.calls.map(call => call.id === id
      ? { ...call, ...update, traceRecorded: update.traceRecorded ?? undefined, completedAt: Date.now() }
      : call),
  })),
  addLocalTrace: (trace) => set(state => ({
    localTraces: [trace, ...state.localTraces.filter(item => item.id !== trace.id)].slice(0, 100),
  })),
  setRemoteTraces: (remoteTraces) => set({ remoteTraces }),
  selectSession: (selectedSessionId) => set({ selectedSessionId }),
  setImportedBundle: (importedBundle) => set({
    importedBundle,
    selectedSessionId: importedBundle?.sessionId ?? null,
  }),
  setFilter: (key, value) => set(state => ({ filters: { ...state.filters, [key]: value } })),
  clearFilters: () => set({ filters: { ...EMPTY_LENS_FILTERS } }),
  markFinding: (signature) => set(state => ({
    findingSignatures: state.findingSignatures.includes(signature)
      ? state.findingSignatures
      : [...state.findingSignatures, signature],
  })),
  resetLensContext: () => set({
    filters: { ...EMPTY_LENS_FILTERS },
    selectedSessionId: null,
    importedBundle: null,
  }),
}));
