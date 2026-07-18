import { sanitizeTraceMetadata, insertAgentTrace, type AgentTraceType } from '@/lib/supabase/traces';
import { getSessionId, uuid } from '@/lib/supabase/session';
import { useDebugStore } from '@/store/debugStore';
import type { AgentRole } from '@/types';
import type { AgentTraceRow } from '@/lib/supabase/types';

interface ClientTraceInput {
  id?: string;
  sessionId?: string;
  agentId: AgentRole;
  traceType: AgentTraceType;
  inputTokens?: number | null;
  outputTokens?: number | null;
  latencyMs?: number | null;
  model?: string | null;
  metadata?: Record<string, unknown> | null;
  /** Server routes already persist live llm_call traces. */
  persist?: boolean;
}

/** Immediate local mirror keeps correlation usable without Supabase or while a query lags. */
export function recordClientTrace(input: ClientTraceInput): AgentTraceRow {
  const id = input.id ?? uuid();
  const sessionId = input.sessionId ?? getSessionId();
  const metadata = sanitizeTraceMetadata(input.metadata);
  const row: AgentTraceRow = {
    id,
    session_id: sessionId,
    agent_id: input.agentId,
    trace_type: input.traceType,
    input_tokens: input.inputTokens ?? null,
    output_tokens: input.outputTokens ?? null,
    latency_ms: input.latencyMs ?? null,
    model: input.model ?? null,
    metadata,
    created_at: new Date().toISOString(),
  };
  useDebugStore.getState().addLocalTrace(row);
  if (input.persist !== false) {
    void insertAgentTrace({ ...input, id, sessionId, metadata });
  }
  return row;
}
