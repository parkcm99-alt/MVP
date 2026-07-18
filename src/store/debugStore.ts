import { create } from 'zustand';
import { getSupabaseConfigStatus } from '@/lib/supabase/client';
import { getSessionId, uuid } from '@/lib/supabase/session';
import type { AgentTraceRow } from '@/lib/supabase/types';
import type { AgentRole } from '@/types';
import type { LlmProvider } from '@/lib/llm/types';

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

export interface AgentCallAttempt {
  id: string;
  role: AgentRole;
  taskTitle: string;
  sessionId: string;
  startedAt: number;
  completedAt?: number;
  provider?: LlmProvider;
  traceRecorded?: boolean;
  failed?: boolean;
}

interface AgentDebugUpdate {
  role: AgentRole;
  provider: LlmProvider;
  traceRecorded?: boolean | null;
  model?: string | null;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  metadata?: Record<string, unknown>;
}

export interface LocalTraceInput {
  sessionId?: string;
  agentId: AgentRole;
  traceType: 'llm_call' | 'tool_use' | 'handoff' | 'decision';
  inputTokens?: number | null;
  outputTokens?: number | null;
  latencyMs?: number | null;
  model?: string | null;
  metadata?: Record<string, unknown> | null;
}

interface DebugStore {
  supabaseStatus: SupabaseDebugStatus;
  latest: AgentDebugSnapshot;
  lastPlanAt: number | null;
  calls: AgentCallAttempt[];
  localTraces: AgentTraceRow[];
  remoteTraces: AgentTraceRow[];
  selectedSessionId: string | null;
  findingSignatures: string[];
  setSupabaseStatus: (status: SupabaseDebugStatus) => void;
  startAgentCall: (role: AgentRole, taskTitle: string, sessionId: string) => string;
  recordAgentResponse: (callId: string, update: AgentDebugUpdate) => void;
  failAgentCall: (callId: string) => void;
  addLocalTrace: (input: LocalTraceInput) => void;
  setRemoteTraces: (traces: AgentTraceRow[]) => void;
  setSelectedSessionId: (sessionId: string | null) => void;
  rememberFinding: (signature: string) => void;
}

const INITIAL_DEBUG: AgentDebugSnapshot = {
  role: null,
  provider: null,
  lastCallAt: null,
  traceRecorded: null,
  model: null,
  latencyMs: null,
  inputTokens: null,
  outputTokens: null,
};

function buildLocalTrace(input: LocalTraceInput): AgentTraceRow {
  return {
    id: `local-${uuid()}`,
    session_id: input.sessionId ?? getSessionId(),
    agent_id: input.agentId,
    trace_type: input.traceType,
    input_tokens: input.inputTokens ?? null,
    output_tokens: input.outputTokens ?? null,
    latency_ms: input.latencyMs ?? null,
    model: input.model ?? null,
    metadata: input.metadata ?? null,
    created_at: new Date().toISOString(),
  };
}

export const useDebugStore = create<DebugStore>((set, get) => ({
  supabaseStatus: getSupabaseConfigStatus() === 'ready'
    ? 'connecting'
    : getSupabaseConfigStatus() === 'missing' ? 'mock' : 'misconfigured',
  latest: INITIAL_DEBUG,
  lastPlanAt: null,
  calls: [],
  localTraces: [],
  remoteTraces: [],
  selectedSessionId: null,
  findingSignatures: [],

  setSupabaseStatus: supabaseStatus => set({ supabaseStatus }),

  startAgentCall: (role, taskTitle, sessionId) => {
    const id = uuid();
    set(state => ({
      calls: [{ id, role, taskTitle, sessionId, startedAt: Date.now() }, ...state.calls].slice(0, 100),
    }));
    return id;
  },

  recordAgentResponse: (callId, update) => {
    const call = get().calls.find(item => item.id === callId);
    const now = Date.now();
    const latest: AgentDebugSnapshot = {
      role: update.role,
      provider: update.provider,
      lastCallAt: now,
      traceRecorded: update.traceRecorded ?? null,
      model: update.model ?? null,
      latencyMs: update.latencyMs ?? null,
      inputTokens: update.inputTokens ?? null,
      outputTokens: update.outputTokens ?? null,
    };
    const localTrace = buildLocalTrace({
      sessionId: call?.sessionId,
      agentId: update.role,
      traceType: 'llm_call',
      inputTokens: update.inputTokens,
      outputTokens: update.outputTokens,
      latencyMs: update.latencyMs,
      model: update.model,
      metadata: {
        provider: update.provider,
        task_title: call?.taskTitle ?? 'unknown task',
        traceRecorded: update.traceRecorded ?? false,
        ...update.metadata,
      },
    });

    set(state => ({
      latest,
      lastPlanAt: update.role === 'planner' ? now : state.lastPlanAt,
      calls: state.calls.map(item => item.id === callId
        ? { ...item, completedAt: now, provider: update.provider, traceRecorded: update.traceRecorded ?? false }
        : item),
      localTraces: [localTrace, ...state.localTraces].slice(0, 200),
    }));
  },

  failAgentCall: callId => set(state => ({
    calls: state.calls.map(item => item.id === callId
      ? { ...item, completedAt: Date.now(), failed: true, traceRecorded: false }
      : item),
  })),

  addLocalTrace: input => set(state => ({
    localTraces: [buildLocalTrace(input), ...state.localTraces].slice(0, 200),
  })),
  setRemoteTraces: remoteTraces => set({ remoteTraces: remoteTraces.slice(0, 100) }),
  setSelectedSessionId: selectedSessionId => set({ selectedSessionId }),
  rememberFinding: signature => set(state => ({
    findingSignatures: [...new Set([...state.findingSignatures, signature])],
  })),
}));
