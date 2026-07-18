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

const SENSITIVE_METADATA_KEYS = ['api_key', 'apikey', 'authorization', 'password', 'secret', 'token', 'service_role', 'credential', 'cookie', 'private_key'];
const MAX_SAFE_ERROR_BODY_LENGTH = 600;

function getSupabaseRestConfig(): { url?: string; key?: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  const isServer = typeof window === 'undefined';

  if (isServer && !serviceRoleKey) {
    console.warn('[Supabase] agent_traces insert warning: missing_service_role_key');
  }

  return {
    url,
    key: isServer ? serviceRoleKey || publicKey : publicKey,
  };
}

function resolveSessionId(sessionId?: string): string {
  const normalized = sessionId?.trim();
  if (normalized) return normalized;

  return typeof window === 'undefined' ? uuid() : getSessionId();
}

function isSensitiveMetadataKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[\s-]/g, '_');
  if (['input_tokens', 'output_tokens', 'token_count', 'token_usage', 'max_tokens'].includes(normalized)) return false;
  return SENSITIVE_METADATA_KEYS.some(sensitiveKey => normalized.includes(sensitiveKey));
}

function nullableNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk-ant-|sk-proj-|sk-|sb_secret_|sbp_)[A-Za-z0-9._-]{8,}/gi, '[redacted]')
    .replace(/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, '[redacted_jwt]')
    .replace(
      /((?:api[_-]?key|authorization|service[_-]?role(?:[_-]?key)?|password|secret|token|credential)\s*[:=]\s*)["']?[^"',\s}]+/gi,
      '$1[redacted]',
    );
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === undefined) return null;
  if (typeof value === 'string') return redactSensitiveText(value).slice(0, 1000);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 30).map(item => sanitizeValue(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 30)
      .filter(([key, item]) => item !== undefined && !isSensitiveMetadataKey(key))
      .map(([key, item]) => [redactSensitiveText(key).slice(0, 100), sanitizeValue(item, depth + 1)]));
  }
  return null;
}

function sanitizeMetadata(metadata?: Record<string, unknown> | null): Record<string, unknown> | null {
  return metadata ? sanitizeValue(metadata) as Record<string, unknown> : null;
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
