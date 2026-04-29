import { getSupabaseClient, isSupabaseConfigured } from './client';
import { getSessionId, uuid } from './session';
import type { AgentTraceInsert } from './types';
import type { AgentRole } from '@/types';

export type AgentTraceType = 'llm_call' | 'tool_use' | 'handoff' | 'decision';

interface InsertAgentTraceParams {
  sessionId?: string;
  agentId: AgentRole;
  traceType: AgentTraceType;
  inputTokens?: number | null;
  outputTokens?: number | null;
  latencyMs?: number | null;
  model?: string | null;
  metadata?: Record<string, unknown> | null;
}

const SENSITIVE_METADATA_KEYS = ['api_key', 'apikey', 'authorization', 'password', 'secret', 'token'];

function resolveSessionId(sessionId?: string): string {
  const normalized = sessionId?.trim();
  if (normalized) return normalized;

  return typeof window === 'undefined' ? uuid() : getSessionId();
}

function isSensitiveMetadataKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[\s-]/g, '_');
  return SENSITIVE_METADATA_KEYS.some(sensitiveKey => normalized.includes(sensitiveKey));
}

function sanitizeMetadata(metadata?: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!metadata) return null;

  return Object.fromEntries(
    Object.entries(metadata).filter(([key, value]) => (
      value !== undefined && !isSensitiveMetadataKey(key)
    )),
  );
}

export async function insertAgentTrace({
  sessionId,
  agentId,
  traceType,
  inputTokens = null,
  outputTokens = null,
  latencyMs = null,
  model = null,
  metadata = null,
}: InsertAgentTraceParams): Promise<void> {
  if (!isSupabaseConfigured) return;

  const sb = getSupabaseClient();
  if (!sb) return;

  const row: AgentTraceInsert = {
    id: uuid(),
    session_id: resolveSessionId(sessionId),
    agent_id: agentId,
    trace_type: traceType,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    latency_ms: latencyMs,
    model,
    metadata: sanitizeMetadata(metadata),
  };

  try {
    const { error } = await sb.from('agent_traces').insert(row);
    if (error) {
      console.warn('[Supabase] agent_traces insert failed:', error.message);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    console.warn('[Supabase] agent_traces insert failed:', message);
  }
}
