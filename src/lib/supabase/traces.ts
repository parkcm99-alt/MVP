import { getSessionId, uuid } from './session';
import type { AgentTraceInsert } from './types';
import type { AgentRole } from '@/types';

export type AgentTraceType = 'llm_call' | 'tool_use' | 'handoff' | 'decision';

interface InsertAgentTraceParams {
  id?: string;
  sessionId?: string;
  agentId: AgentRole;
  traceType: AgentTraceType;
  inputTokens?: number | null;
  outputTokens?: number | null;
  latencyMs?: number | null;
  model?: string | null;
  metadata?: Record<string, unknown> | null;
}

const SENSITIVE_METADATA_KEYS = /api[_-]?key|apikey|authorization|auth|bearer|credential|password|secret|token|service[_-]?role|private[_-]?key/i;
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
  return SENSITIVE_METADATA_KEYS.test(key.replace(/[\s-]/g, '_'));
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === undefined) return null;
  if (typeof value === 'string') return redactSensitiveText(value).slice(0, 1000);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 30).map(item => sanitizeValue(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key, item]) => item !== undefined && !isSensitiveMetadataKey(key))
        .slice(0, 30)
        .map(([key, item]) => [key.slice(0, 80), sanitizeValue(item, depth + 1)]),
    );
  }
  return null;
}

export function sanitizeTraceMetadata(metadata?: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!metadata) return null;
  return sanitizeValue(metadata) as Record<string, unknown>;
}

function nullableNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-[redacted]')
    .replace(/sk-(?:proj-)?[A-Za-z0-9_-]{12,}/g, 'sk-[redacted]')
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/gi, 'sb_[redacted]')
    .replace(/sbp_[A-Za-z0-9_-]{12,}/gi, 'sbp_[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, '[redacted_jwt]')
    .replace(
      /((?:api[_-]?key|authorization|credential|password|secret|token|private[_-]?key|service[_-]?role(?:[_-]?key)?)\s*[:=]\s*)["']?[^"',\s}]+/gi,
      '$1[redacted]',
    );
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
  id,
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
      id: id ?? uuid(),
      session_id: resolveSessionId(sessionId),
      agent_id: agentId,
      trace_type: traceType,
      input_tokens: nullableNumber(inputTokens),
      output_tokens: nullableNumber(outputTokens),
      latency_ms: nullableNumber(latencyMs),
      model,
      metadata: sanitizeTraceMetadata(metadata),
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
