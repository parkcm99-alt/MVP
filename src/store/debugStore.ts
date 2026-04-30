import { create } from 'zustand';
import { getSupabaseConfigStatus } from '@/lib/supabase/client';
import type { LlmProvider } from '@/lib/llm/types';
import type { AgentRole } from '@/types';

// ── Full Flow Summary ─────────────────────────────────────────────────────────

export interface FullFlowSummaryData {
  status: 'running' | 'completed' | 'failed';
  plannerSummary:          string | null;
  architectSummary:        string | null;
  developerSummary:        string | null;
  reviewerSummary:         string | null;
  reviewerApprovalStatus:  'approved' | 'changes_requested' | 'needs_more_info' | null;
  qaSummary:               string | null;
  qaFinalStatus:           'passed' | 'failed' | 'needs_more_testing' | null;
  totalLatencyMs:          number;
  totalInputTokens:        number;
  totalOutputTokens:       number;
  completedAt:             number | null;
  failedAgent:             string | null;
  failReason:              string | null;
  completedAgents:         string[];
  /** The user's original work request text, if provided. */
  originalRequest:         string | null;
}

export type SupabaseDebugStatus = 'mock' | 'misconfigured' | 'connecting' | 'ready' | 'partial' | 'error';

interface PlannerDebugSnapshot {
  agentId: AgentRole | null;
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
  agentId?: AgentRole;
  traceRecorded?: boolean | null;
  model?: string | null;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
}

interface DebugStore {
  supabaseStatus: SupabaseDebugStatus;
  planner: PlannerDebugSnapshot;
  lastLlm: PlannerDebugSnapshot;
  traceRefreshAt: number | null;
  lastFlowSummary: string | null;
  fullFlowData: FullFlowSummaryData | null;
  setSupabaseStatus: (status: SupabaseDebugStatus) => void;
  recordPlannerResponse: (update: PlannerDebugUpdate) => void;
  recordAgentResponse: (update: PlannerDebugUpdate) => void;
  refreshTraces: () => void;
  setLastFlowSummary: (summary: string) => void;
  setFullFlowData: (data: FullFlowSummaryData) => void;
}

const INITIAL_PLANNER_DEBUG: PlannerDebugSnapshot = {
  agentId: null,
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
  lastLlm: INITIAL_PLANNER_DEBUG,
  traceRefreshAt: null,
  lastFlowSummary: null,
  fullFlowData: null,

  setSupabaseStatus: (supabaseStatus) => set({ supabaseStatus }),

  recordPlannerResponse: (update) =>
    set(() => {
      const snapshot = {
        agentId: update.agentId ?? 'planner',
        provider: update.provider,
        lastPlanAt: Date.now(),
        traceRecorded: update.traceRecorded ?? null,
        model: update.model ?? null,
        latencyMs: update.latencyMs ?? null,
        inputTokens: update.inputTokens ?? null,
        outputTokens: update.outputTokens ?? null,
      };
      return {
        planner: snapshot,
        lastLlm: snapshot,
        traceRefreshAt: snapshot.lastPlanAt,
      };
    }),

  recordAgentResponse: (update) =>
    set(() => {
      const snapshot = {
        agentId: update.agentId ?? null,
        provider: update.provider,
        lastPlanAt: Date.now(),
        traceRecorded: update.traceRecorded ?? null,
        model: update.model ?? null,
        latencyMs: update.latencyMs ?? null,
        inputTokens: update.inputTokens ?? null,
        outputTokens: update.outputTokens ?? null,
      };
      return {
        lastLlm: snapshot,
        traceRefreshAt: snapshot.lastPlanAt,
      };
    }),

  refreshTraces: () => set({ traceRefreshAt: Date.now() }),

  setLastFlowSummary: (summary) => set({ lastFlowSummary: summary }),

  setFullFlowData: (data) => set({ fullFlowData: data }),
}));
