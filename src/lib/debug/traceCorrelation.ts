import type { AgentTraceRow } from '@/lib/supabase/types';

export const TRACE_BUNDLE_SCHEMA = 1;
export const LOCAL_TRACE_KEY = 'agent-office-local-traces-v1';
const SENSITIVE = /api[_-]?key|authorization|bearer|credential|password|secret|service[_-]?role|token/i;

export interface TraceBundle { schemaVersion: 1; exportedAt: string; sessionId: string; traces: AgentTraceRow[]; }

export function redact(value: unknown, key = ''): unknown {
  if (SENSITIVE.test(key)) return '[REDACTED]';
  if (typeof value === 'string' && /(bearer\s+[\w.-]+|sk-[\w-]{12,}|ghp_[\w]{12,})/i.test(value)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map(v => redact(v));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k,v]) => [k, redact(v,k)]));
  return value;
}

export function loadLocalTraces(): AgentTraceRow[] {
  if (typeof window === 'undefined') return [];
  try { const v = JSON.parse(localStorage.getItem(LOCAL_TRACE_KEY) || '[]'); return Array.isArray(v) ? v.slice(0,100) : []; } catch { return []; }
}

export function appendLocalTrace(trace: Partial<AgentTraceRow> & Pick<AgentTraceRow,'session_id'|'agent_id'|'trace_type'>) {
  if (typeof window === 'undefined') return;
  const row: AgentTraceRow = { id: crypto.randomUUID?.() ?? `${Date.now()}`, input_tokens:null, output_tokens:null, latency_ms:null, model:null, metadata:null, created_at:new Date().toISOString(), ...trace };
  localStorage.setItem(LOCAL_TRACE_KEY, JSON.stringify([row, ...loadLocalTraces()].slice(0,100)));
  window.dispatchEvent(new Event('agent-office-traces-changed'));
}

export function parseBundle(text: string): TraceBundle {
  const raw = JSON.parse(text) as Partial<TraceBundle>;
  if (raw.schemaVersion !== TRACE_BUNDLE_SCHEMA) throw new Error('Unsupported bundle schema version.');
  if (!raw.sessionId || !Array.isArray(raw.traces) || raw.traces.length > 1000) throw new Error('Invalid trace bundle.');
  if (raw.traces.some(t => !t || typeof t.id !== 'string' || typeof t.session_id !== 'string' ||
    typeof t.agent_id !== 'string' || typeof t.trace_type !== 'string' || typeof t.created_at !== 'string')) {
    throw new Error('Malformed trace entries.');
  }
  return redact(raw) as TraceBundle;
}
