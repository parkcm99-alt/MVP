'use client';

import { useDebugStore } from '@/store/debugStore';
import { getSessionId } from '@/lib/supabase/session';
import { insertAgentTrace, type AgentTraceType } from '@/lib/supabase/traces';
import type { AgentRole } from '@/types';

interface ClientTrace {
  sessionId?: string;
  agentId: AgentRole;
  traceType: AgentTraceType;
  inputTokens?: number | null;
  outputTokens?: number | null;
  latencyMs?: number | null;
  model?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Immediate local mirror plus best-effort browser insert for handoff/decision traces. */
export async function recordClientTrace(trace: ClientTrace): Promise<boolean> {
  const sessionId = trace.sessionId ?? getSessionId();
  useDebugStore.getState().addLocalTrace({
    session_id: sessionId, agent_id: trace.agentId, trace_type: trace.traceType,
    input_tokens: trace.inputTokens ?? null, output_tokens: trace.outputTokens ?? null,
    latency_ms: trace.latencyMs ?? null, model: trace.model ?? null, metadata: trace.metadata ?? null,
  });
  return insertAgentTrace({ ...trace, sessionId });
}

/** API responses are mirrored locally even in zero-config/mock mode; server owns live inserts. */
export function mirrorLlmTrace(trace: Omit<ClientTrace, 'traceType'>): void {
  useDebugStore.getState().addLocalTrace({
    session_id: trace.sessionId ?? getSessionId(), agent_id: trace.agentId, trace_type: 'llm_call',
    input_tokens: trace.inputTokens ?? null, output_tokens: trace.outputTokens ?? null,
    latency_ms: trace.latencyMs ?? null, model: trace.model ?? null, metadata: trace.metadata ?? null,
  });
}
