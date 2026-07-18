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

const MAX_SAFE_ERROR_BODY_LENGTH = 600;
const SECRET_VALUE = /(?:sk-(?:ant-|proj-)?[a-z0-9_-]{12,}|sb_(?:secret|publishable)_[a-z0-9_-]{12,}|bearer\s+\S+|eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_.-]{10,}|(?:api[_ -]?key|authorization|password|secret|service[_ -]?role|(?:access|refresh)[_ -]?token)\s*[:=]\s*\S+)/i;

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
  if (normalized === 'input_tokens' || normalized === 'output_tokens') return false;
  return /api_?key|authorization|bearer|credential|password|secret|service_?role|(?:^|_)token(?:$|_)|access_?token|refresh_?token|private_?key|anon_?key/.test(normalized);
}

function sanitizeMetadataValue(value: unknown, key = '', depth = 0): unknown {
  if (isSensitiveMetadataKey(key)) return '[REDACTED]';
  if (typeof value === 'string') return SECRET_VALUE.test(value) ? '[REDACTED]' : value.slice(0, 1000);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || value === null) return value;
  if (depth >= 5) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, 30).map(item => sanitizeMetadataValue(item, '', depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).slice(0, 40)
      .filter(([entryKey, entryValue]) => entryValue !== undefined && !['__proto__', 'constructor', 'prototype'].includes(entryKey))
      .map(([entryKey, entryValue]) => [entryKey.slice(0, 100), sanitizeMetadataValue(entryValue, entryKey, depth + 1)]),
  );
  return null;
}

function sanitizeMetadata(metadata?: Record<string, unknown> | null): Record<string, unknown> | null {
  return metadata ? sanitizeMetadataValue(metadata) as Record<string, unknown> : null;
}

function nullableNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-[redacted]')
    .replace(/bearer\s+[^\s",}]+/gi, 'Bearer [redacted]')
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
