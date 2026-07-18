import { getSessionId, uuid } from './session';
import type { AgentTraceInsert } from './types';
import type { AgentRole } from '@/types';
import { redactText, sanitizeValue } from '@/lib/debug/sanitize';

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

const MAX_SAFE_ERROR_BODY_LENGTH = 600;

function getSupabaseRestConfig(): { url?: string; key?: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const isServer = typeof window === 'undefined';

  if (isServer && !serviceRoleKey) {
    console.warn('[Supabase] agent_traces insert warning: missing_service_role_key');
  }

  return {
    url,
    key: isServer ? serviceRoleKey ?? publicKey : publicKey,
  };
}

function resolveSessionId(sessionId?: string): string {
  const normalized = sessionId?.trim();
  if (normalized) return normalized;

  return typeof window === 'undefined' ? uuid() : getSessionId();
}

function sanitizeMetadata(metadata?: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!metadata) return null;
  // Trace metadata is deliberately tiny and deeply redacted. Never forward a
  // nested credential merely because its parent key happened to be harmless.
  return sanitizeValue(metadata) as Record<string, unknown>;
}

function nullableNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function redactSensitiveText(value: string): string {
  return redactText(value);
}

async function getSafeErrorBody(response: Response): Promise<string> {
  try {
    const body = await response.text();
    if (!body.trim()) return 'empty_body';
    return redactSensitiveText(body).slice(0, MAX_SAFE_ERROR_BODY_LENGTH);
  } catch {
    return 'unreadable_body';
  }
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
}: InsertAgentTraceParams): Promise<boolean> {
  try {
    const { url, key } = getSupabaseRestConfig();
    if (!url || !key) {
      console.warn('[Supabase] agent_traces insert skipped: missing_config');
      return false;
    }

    const row: AgentTraceInsert = {
      id: uuid(),
      session_id: resolveSessionId(sessionId),
      agent_id: agentId,
      trace_type: traceType,
      input_tokens: nullableNumber(inputTokens),
      output_tokens: nullableNumber(outputTokens),
      latency_ms: nullableNumber(latencyMs),
      model,
      metadata: sanitizeMetadata(metadata),
    };

    const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/agent_traces`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
    });

    if (!response.ok) {
      console.warn(
        '[Supabase] agent_traces insert failed:',
        `http_${response.status}`,
        await getSafeErrorBody(response),
      );
      return false;
    }

    return true;
  } catch (error) {
    const message = error instanceof Error ? redactSensitiveText(error.message) : 'unknown_error';
    console.warn('[Supabase] agent_traces insert failed:', message);
    return false;
  }
}
