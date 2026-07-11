import type { AgentTraceRow } from '@/lib/supabase/types';
import { getSessionId } from '@/lib/supabase/session';

const KEY = 'agent-office-local-traces-v1';
const LIMIT = 100;

export function readLocalTraces(): AgentTraceRow[] {
  if (typeof window === 'undefined') return [];
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(value) ? value.slice(0, LIMIT) as AgentTraceRow[] : [];
  } catch { return []; }
}

export function appendLocalTrace(trace: Omit<AgentTraceRow, 'id'|'session_id'|'created_at'> & { session_id?: string }): void {
  if (typeof window === 'undefined') return;
  const row: AgentTraceRow = {
    ...trace,
    id: crypto.randomUUID(),
    session_id: trace.session_id ?? getSessionId(),
    created_at: new Date().toISOString(),
  };
  const next = [row, ...readLocalTraces()].slice(0, LIMIT);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* local fallback is best effort */ }
  window.dispatchEvent(new CustomEvent('local-agent-trace', { detail: row }));
}
