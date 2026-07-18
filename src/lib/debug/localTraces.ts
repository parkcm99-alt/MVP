import { uuid } from '@/lib/supabase/session';
import type { AgentTraceRow } from '@/lib/supabase/types';
import type { AgentRole } from '@/types';
import { sanitizeRecord } from './sanitize';

const LIMIT = 100;
let traces: AgentTraceRow[] = [];
const listeners = new Set<() => void>();

export function getLocalTraces(): AgentTraceRow[] {
  return traces;
}

export function subscribeLocalTraces(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function addLocalTrace(row: AgentTraceRow): void {
  if (typeof window === 'undefined') return;
  traces = [row, ...traces.filter(trace => trace.id !== row.id)].slice(0, LIMIT);
  listeners.forEach(listener => listener());
}

export function createLocalTrace(input: {
  sessionId: string;
  agentId: AgentRole;
  traceType: string;
  model?: string | null;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  metadata?: Record<string, unknown> | null;
}): void {
  addLocalTrace({
    id: uuid(),
    session_id: input.sessionId,
    agent_id: input.agentId,
    trace_type: input.traceType,
    model: input.model ?? null,
    latency_ms: input.latencyMs ?? null,
    input_tokens: input.inputTokens ?? null,
    output_tokens: input.outputTokens ?? null,
    metadata: sanitizeRecord({ ...input.metadata, local_only: true }),
    created_at: new Date().toISOString(),
  });
}

export function clearLocalTraces(): void {
  traces = [];
  listeners.forEach(listener => listener());
}
