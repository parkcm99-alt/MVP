import { create } from 'zustand';
import { getSupabaseConfigStatus } from '@/lib/supabase/client';
import type { LlmProvider } from '@/lib/llm/types';
import type { AgentTraceRow } from '@/lib/supabase/types';

export type SupabaseDebugStatus = 'mock' | 'misconfigured' | 'connecting' | 'ready' | 'partial' | 'error';

interface PlannerDebugSnapshot {
  provider: LlmProvider | null;
  lastPlanAt: number | null;
  role: string | null;
  traceRecorded: boolean | null;
  model: string | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

interface PlannerDebugUpdate {
  provider: LlmProvider;
  role?: string;
  sessionId?: string;
  taskTitle?: string;
  traceRecorded?: boolean | null;
  model?: string | null;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
}

export interface AgentCallSnapshot {
  id: string;
  sessionId: string;
  role: string;
  taskTitle: string;
  at: number;
  traceRecorded: boolean;
  latencyMs: number | null;
}

interface DebugStore {
  supabaseStatus: SupabaseDebugStatus;
  planner: PlannerDebugSnapshot;
  localTraces: AgentTraceRow[];
  observedTraces: AgentTraceRow[];
  setSupabaseStatus: (status: SupabaseDebugStatus) => void;
  recordPlannerResponse: (update: PlannerDebugUpdate) => void;
  recordAgentResponse: (update: PlannerDebugUpdate) => void;
  recentAgentCalls: AgentCallSnapshot[];
  addLocalTrace: (trace: AgentTraceRow) => void;
  setObservedTraces: (traces: AgentTraceRow[]) => void;
  highlightedTaskTitles: string[];
  setHighlightedTaskTitles: (titles: string[]) => void;
}

const INITIAL_PLANNER_DEBUG: PlannerDebugSnapshot = {
  provider: null,
  lastPlanAt: null,
  role: null,
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
  recentAgentCalls: [],
  localTraces: [],
  observedTraces: [],
  highlightedTaskTitles: [],
  setHighlightedTaskTitles: (highlightedTaskTitles) => set({ highlightedTaskTitles: highlightedTaskTitles.slice(0, 100) }),

  setSupabaseStatus: (supabaseStatus) => set({ supabaseStatus }),

  recordPlannerResponse: (update) =>
    set({
      planner: {
        provider: update.provider,
        lastPlanAt: Date.now(),
        role: update.role ?? 'planner',
        traceRecorded: update.traceRecorded ?? null,
        model: update.model ?? null,
        latencyMs: update.latencyMs ?? null,
        inputTokens: update.inputTokens ?? null,
        outputTokens: update.outputTokens ?? null,
      },
    }),
  recordAgentResponse: (update) =>
    set(state => ({
      planner: {
        provider: update.provider,
        lastPlanAt: Date.now(),
        role: update.role ?? null,
        traceRecorded: update.traceRecorded ?? null,
        model: update.model ?? null,
        latencyMs: update.latencyMs ?? null,
        inputTokens: update.inputTokens ?? null,
        outputTokens: update.outputTokens ?? null,
      },
      recentAgentCalls: update.sessionId && update.role
        ? [{
            id: `${Date.now()}-${update.role}`,
            sessionId: update.sessionId,
            role: update.role,
            taskTitle: update.taskTitle ?? '',
            at: Date.now(),
            traceRecorded: update.traceRecorded === true,
            latencyMs: update.latencyMs ?? null,
          }, ...state.recentAgentCalls].slice(0, 30)
        : state.recentAgentCalls,
    })),
  addLocalTrace: (trace) =>
    set(state => ({
      localTraces: [trace, ...state.localTraces].slice(0, 100),
    })),
  setObservedTraces: (observedTraces) => set({ observedTraces: observedTraces.slice(0, 100) }),
}));
