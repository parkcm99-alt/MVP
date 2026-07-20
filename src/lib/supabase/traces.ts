import { addLocalTrace } from '@/lib/debug/localTraces';
import { redactText, sanitizeRecord } from '@/lib/debug/sanitize';
import type { AgentRole } from '@/types';
import { useOperationsStore } from '@/store/operationsStore';
import { getSessionId, uuid } from './session';
import type { AgentTraceInsert } from './types';

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
const TRACE_INSERT_TIMEOUT_MS = 5_000;
let didWarnMissingServiceRole = false;

function getSupabaseRestConfig(): { url?: string; key?: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const isServer = typeof window === 'undefined';

  if (isServer && !serviceRoleKey && !didWarnMissingServiceRole) {
    didWarnMissingServiceRole = true;
    console.warn('[Supabase] agent_traces insert warning: missing_service_role_key');
  }

  return { url, key: isServer ? serviceRoleKey || publicKey : publicKey };
}

function resolveSessionId(sessionId?: string): string {
  const normalized = sessionId?.trim();
  if (normalized) return normalized;
  return typeof window === 'undefined' ? uuid() : getSessionId();
}

function nullableNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function getSafeErrorBody(response: Response): Promise<string> {
  try {
    const body = await response.text();
    return body.trim() ? redactText(body).slice(0, MAX_SAFE_ERROR_BODY_LENGTH) : 'empty_body';
  } catch {
    return 'unreadable_body';
  }
}

/** Best-effort insert. It never throws and never stores an unsanitized metadata value. */
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
    if (typeof window !== 'undefined' && useOperationsStore.getState().readOnlyAnalysis) return false;
    const row: AgentTraceInsert = {
      id: uuid(),
      session_id: resolveSessionId(sessionId),
      agent_id: agentId,
      trace_type: traceType,
      input_tokens: nullableNumber(inputTokens),
      output_tokens: nullableNumber(outputTokens),
      latency_ms: nullableNumber(latencyMs),
      model,
      metadata: sanitizeRecord(metadata),
    };

    // The same id lets the viewer merge this bounded browser copy with a remote row.
    if (typeof window !== 'undefined') {
      addLocalTrace({ ...row, created_at: new Date().toISOString() });
    }

    const { url, key } = getSupabaseRestConfig();
    if (!url || !key) {
      console.warn('[Supabase] agent_traces insert skipped: missing_config');
      return false;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TRACE_INSERT_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/agent_traces`, {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(row),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      console.warn('[Supabase] agent_traces insert failed:', `http_${response.status}`, await getSafeErrorBody(response));
      return false;
    }
    return true;
  } catch (error) {
    const reason = error instanceof Error && error.name === 'AbortError'
      ? 'timeout'
      : error instanceof Error ? redactText(error.message) : 'unknown_error';
    console.warn('[Supabase] agent_traces insert failed:', reason);
    return false;
  }
}
