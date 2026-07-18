import { create } from 'zustand';
import { createLocalTrace } from '@/lib/debug/localTraces';
import { getSupabaseConfigStatus } from '@/lib/supabase/client';
import { uuid } from '@/lib/supabase/session';
import type { AgentApiResponse, LlmProvider } from '@/lib/llm/types';
import type { AgentRole } from '@/types';

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

export interface AgentCallSnapshot {
  id: string;
  sessionId: string;
  role: AgentRole;
  taskTitle: string;
  startedAt: number;
  completedAt: number | null;
  provider: LlmProvider | null;
  traceRecorded: boolean | null;
  model: string | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  finalStatus?: string;
  approvalStatus?: string;
}

interface DebugStore {
  supabaseStatus: SupabaseDebugStatus;
  latest: AgentDebugSnapshot;
  calls: AgentCallSnapshot[];
  setSupabaseStatus: (status: SupabaseDebugStatus) => void;
  startAgentCall: (role: AgentRole, taskTitle: string, sessionId: string) => string;
  recordAgentResponse: (callId: string, response: AgentApiResponse) => void;
  recordAgentFailure: (callId: string) => void;
  resetCalls: () => void;
}

const INITIAL_LATEST: AgentDebugSnapshot = {
  role: null,
  provider: null,
  lastCallAt: null,
  traceRecorded: null,
  model: null,
  latencyMs: null,
  inputTokens: null,
  outputTokens: null,
};

export const useDebugStore = create<DebugStore>((set, get) => ({
  supabaseStatus: getSupabaseConfigStatus() === 'ready'
    ? 'connecting'
    : getSupabaseConfigStatus() === 'missing' ? 'mock' : 'misconfigured',
  latest: INITIAL_LATEST,
  calls: [],

  setSupabaseStatus: supabaseStatus => set({ supabaseStatus }),

  startAgentCall: (role, taskTitle, sessionId) => {
    const id = uuid();
    const startedAt = Date.now();
    createLocalTrace({
      sessionId,
      agentId: role,
      traceType: 'tool_use',
      metadata: { action: 'ask_agent', task_title: taskTitle },
    });
    set(state => ({
      calls: [{
        id, sessionId, role, taskTitle, startedAt,
        completedAt: null, provider: null, traceRecorded: null,
        model: null, latencyMs: null, inputTokens: null, outputTokens: null,
      }, ...state.calls].slice(0, 100),
    }));
    return id;
  },

  recordAgentResponse: (callId, response) => {
    const call = get().calls.find(item => item.id === callId);
    const completedAt = Date.now();
    const update = {
      completedAt,
      provider: response.provider,
      traceRecorded: response.traceRecorded ?? false,
      model: response.model ?? null,
      latencyMs: response.latencyMs ?? null,
      inputTokens: response.inputTokens ?? null,
      outputTokens: response.outputTokens ?? null,
      ...('finalStatus' in response ? { finalStatus: response.finalStatus } : {}),
      ...('approvalStatus' in response ? { approvalStatus: response.approvalStatus } : {}),
    };
    // Preserve evidence of a real call when the database write failed; successful
    // writes are loaded from Supabase using their canonical row id.
    if (call && response.provider === 'claude' && !response.traceRecorded) {
      createLocalTrace({
        sessionId: call.sessionId,
        agentId: call.role,
        traceType: 'llm_call',
        model: response.model,
        latencyMs: response.latencyMs,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        metadata: {
          task_title: call.taskTitle,
          provider: 'claude',
          traceRecorded: false,
          ...('finalStatus' in response ? { finalStatus: response.finalStatus } : {}),
          ...('approvalStatus' in response ? { approvalStatus: response.approvalStatus } : {}),
        },
      });
    }
    set(state => ({
      calls: state.calls.map(item => item.id === callId ? { ...item, ...update } : item),
      latest: {
        role: response.role,
        provider: response.provider,
        lastCallAt: completedAt,
        traceRecorded: response.traceRecorded ?? false,
        model: response.model ?? null,
        latencyMs: response.latencyMs ?? null,
        inputTokens: response.inputTokens ?? null,
        outputTokens: response.outputTokens ?? null,
      },
    }));
  },

  recordAgentFailure: callId => set(state => ({
    calls: state.calls.map(call => call.id === callId
      ? { ...call, completedAt: Date.now(), provider: 'mock', traceRecorded: false }
      : call),
    latest: {
      ...INITIAL_LATEST,
      role: state.calls.find(call => call.id === callId)?.role ?? null,
      provider: 'mock',
      lastCallAt: Date.now(),
      traceRecorded: false,
    },
  })),

  resetCalls: () => set({ calls: [], latest: INITIAL_LATEST }),
}));
