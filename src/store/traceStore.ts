'use client';

import { create } from 'zustand';
import type { TraceBundle, TraceInvocation } from '@/lib/debug/types';
import { insertAgentTrace, type AgentTraceType } from '@/lib/supabase/traces';
import { getSessionId, uuid } from '@/lib/supabase/session';
import type { AgentTraceRow } from '@/lib/supabase/types';
import type { AgentRole } from '@/types';

interface LocalTraceInput {
  sessionId?: string;
  agentId: AgentRole;
  traceType: AgentTraceType;
  inputTokens?: number | null;
  outputTokens?: number | null;
  latencyMs?: number | null;
  model?: string | null;
  metadata?: Record<string, unknown> | null;
}

interface TraceStore {
  remoteTraces: AgentTraceRow[];
  localTraces: AgentTraceRow[];
  invocations: TraceInvocation[];
  selectedSessionId: string | null;
  importedBundle: TraceBundle | null;
  findingSignatures: string[];
  setRemoteTraces: (traces: AgentTraceRow[]) => void;
  addLocalTrace: (trace: AgentTraceRow) => void;
  recordInvocation: (invocation: TraceInvocation) => void;
  selectSession: (sessionId: string | null) => void;
  setImportedBundle: (bundle: TraceBundle | null) => void;
  markFinding: (signature: string) => void;
  clearLocal: () => void;
}

export const useTraceStore = create<TraceStore>((set) => ({
  remoteTraces: [],
  localTraces: [],
  invocations: [],
  selectedSessionId: null,
  importedBundle: null,
  findingSignatures: [],
  setRemoteTraces: remoteTraces => set({ remoteTraces }),
  addLocalTrace: trace => set(s => ({ localTraces: [trace, ...s.localTraces].slice(0, 100) })),
  recordInvocation: invocation => set(s => ({ invocations: [invocation, ...s.invocations].slice(0, 100) })),
  selectSession: selectedSessionId => set({ selectedSessionId }),
  setImportedBundle: importedBundle => set({ importedBundle, selectedSessionId: importedBundle?.sessionId ?? null }),
  markFinding: signature => set(s => ({ findingSignatures: [...s.findingSignatures, signature] })),
  clearLocal: () => set({ localTraces: [], invocations: [], selectedSessionId: null, importedBundle: null, findingSignatures: [] }),
}));

function localRow(input: LocalTraceInput): AgentTraceRow {
  return {
    id: uuid(), session_id: input.sessionId ?? getSessionId(), agent_id: input.agentId,
    trace_type: input.traceType, input_tokens: input.inputTokens ?? null,
    output_tokens: input.outputTokens ?? null, latency_ms: input.latencyMs ?? null,
    model: input.model ?? null, metadata: input.metadata ?? null,
    created_at: new Date().toISOString(),
  };
}

/** Local mirror keeps the debugger usable without Supabase; persistence stays best-effort. */
export function recordClientTrace(input: LocalTraceInput, persist = true): void {
  useTraceStore.getState().addLocalTrace(localRow(input));
  if (persist) void insertAgentTrace(input);
}

export function recordAgentInvocation(
  invocation: Omit<TraceInvocation, 'id' | 'completedAt'>,
  telemetry?: { model?: string | null; latencyMs?: number | null; inputTokens?: number | null; outputTokens?: number | null; metadata?: Record<string, unknown> },
): void {
  useTraceStore.getState().recordInvocation({ ...invocation, id: uuid(), completedAt: Date.now() });
  // A returned mock response is a useful local observation, not a database llm_call.
  // A live response is mirrored locally while the server owns its one persisted row.
  if (!invocation.failed && invocation.provider) {
    recordClientTrace({
      sessionId: invocation.sessionId, agentId: invocation.agentId, traceType: 'llm_call',
      model: telemetry?.model, latencyMs: telemetry?.latencyMs,
      inputTokens: telemetry?.inputTokens, outputTokens: telemetry?.outputTokens,
      metadata: {
        provider: invocation.provider, task_title: invocation.taskTitle,
        trace_recorded: invocation.traceRecorded,
        ...telemetry?.metadata,
      },
    }, false);
  }
}
