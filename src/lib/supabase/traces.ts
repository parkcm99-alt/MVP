import { isSupabaseJwtKey, isSupabaseProjectUrl } from './config';
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
const MAX_SAFE_ERROR_BODY_LENGTH = 600;
const warnedRestConfigReasons = new Set<string>();

function warnRestConfigOnce(reason: string): void {
  if (warnedRestConfigReasons.has(reason)) return;
  warnedRestConfigReasons.add(reason);
  console.warn('[Supabase] agent_traces config warning:', reason);
}

function getSupabaseRestConfig(): { url?: string; key?: string; reason?: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  const isServer = typeof window === 'undefined';

  if (!url) {
    return { reason: 'missing_supabase_url' };
  }

  if (!isSupabaseProjectUrl(url)) {
    warnRestConfigOnce('invalid_supabase_url');
    return { url, reason: 'invalid_supabase_url' };
  }

  if (isServer) {
    if (isSupabaseJwtKey(serviceRoleKey)) {
      return { url, key: serviceRoleKey };
    }

    warnRestConfigOnce(serviceRoleKey ? 'invalid_service_role_key' : 'missing_service_role_key');
  }

  if (isSupabaseJwtKey(publicKey)) {
    return { url, key: publicKey };
  }

  if (publicKey) {
    warnRestConfigOnce('invalid_public_anon_key');
    return { url, reason: 'invalid_public_anon_key' };
  }

  return { url, reason: 'missing_public_anon_key' };
}

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

function nullableNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-[redacted]')
    .replace(/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, '[redacted_jwt]')
    .replace(
      /((?:api[_-]?key|authorization|password|secret|token)\s*[:=]\s*)["']?[^"',\s}]+/gi,
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
    const { url, key, reason } = getSupabaseRestConfig();
    if (!url || !key) {
      console.warn('[Supabase] agent_traces insert skipped:', reason ?? 'missing_config');
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
