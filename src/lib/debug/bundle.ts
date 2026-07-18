import type { AgentTraceRow } from '@/lib/supabase/types';
import type { AgentCallSnapshot } from '@/store/debugStore';
import type { AgentStatus, SimEvent, SimTask } from '@/types';
import { sanitizeValue } from './sanitize';

export const DEBUG_BUNDLE_VERSION = 1;
export const MAX_BUNDLE_BYTES = 1_000_000;

export interface DebugBundleAgent {
  id: string;
  status: AgentStatus;
  currentTask: string | null;
}

export interface DebugBundle {
  schemaVersion: 1;
  kind: 'agent-trace-correlation';
  exportedAt: string;
  sessionId: string;
  traces: AgentTraceRow[];
  calls: AgentCallSnapshot[];
  tasks: SimTask[];
  events: SimEvent[];
  agents: DebugBundleAgent[];
}

export function createDebugBundle(input: Omit<DebugBundle, 'schemaVersion' | 'kind' | 'exportedAt'>): DebugBundle {
  return sanitizeValue({
    schemaVersion: DEBUG_BUNDLE_VERSION,
    kind: 'agent-trace-correlation',
    exportedAt: new Date().toISOString(),
    ...input,
  }) as DebugBundle;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function validArray(value: unknown, maximum: number): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.length <= maximum && value.every(isObject);
}

function nullableString(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

function nullableNumber(value: unknown): boolean {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function optionalString(value: unknown): boolean {
  return typeof value === 'undefined' || typeof value === 'string';
}

function optionalRecord(value: unknown): boolean {
  return typeof value === 'undefined' || value === null || isObject(value);
}

/** Reject unsupported/corrupt bundles before any view state is changed. */
export function parseDebugBundle(raw: string): { bundle: DebugBundle | null; error: string | null } {
  if (raw.length > MAX_BUNDLE_BYTES) return { bundle: null, error: 'Bundle is too large (maximum 1 MB).' };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { bundle: null, error: 'Invalid JSON bundle.' };
  }
  if (!isObject(value) || value.kind !== 'agent-trace-correlation') {
    return { bundle: null, error: 'Unsupported debug bundle format.' };
  }
  if (value.schemaVersion !== DEBUG_BUNDLE_VERSION) {
    return { bundle: null, error: 'Unsupported schema version.' };
  }
  if (typeof value.sessionId !== 'string' || !value.sessionId.trim()
    || !validArray(value.traces, 100) || !validArray(value.calls, 100)
    || !validArray(value.tasks, 100) || !validArray(value.events, 200)
    || !validArray(value.agents, 10)) {
    return { bundle: null, error: 'Bundle data is incomplete or malformed.' };
  }
  if (!value.traces.every(trace => typeof trace.id === 'string'
    && typeof trace.session_id === 'string'
    && typeof trace.agent_id === 'string'
    && typeof trace.trace_type === 'string'
    && typeof trace.created_at === 'string' && !Number.isNaN(Date.parse(trace.created_at))
    && nullableNumber(trace.input_tokens) && nullableNumber(trace.output_tokens)
    && nullableNumber(trace.latency_ms) && nullableString(trace.model)
    && optionalRecord(trace.metadata))) {
    return { bundle: null, error: 'Bundle trace data is malformed.' };
  }
  if (!value.calls.every(call => typeof call.id === 'string'
    && typeof call.sessionId === 'string'
    && typeof call.role === 'string'
    && typeof call.taskTitle === 'string'
    && typeof call.startedAt === 'number' && nullableNumber(call.completedAt)
    && nullableString(call.provider)
    && (call.traceRecorded === null || typeof call.traceRecorded === 'boolean')
    && nullableString(call.model) && nullableNumber(call.latencyMs)
    && nullableNumber(call.inputTokens) && nullableNumber(call.outputTokens)
    && optionalString(call.finalStatus) && optionalString(call.approvalStatus))) {
    return { bundle: null, error: 'Bundle call data is malformed.' };
  }
  if (!value.tasks.every(task => typeof task.id === 'string'
    && typeof task.title === 'string' && typeof task.description === 'string'
    && nullableString(task.assignedTo) && typeof task.status === 'string'
    && typeof task.priority === 'string' && typeof task.createdAt === 'number'
    && typeof task.updatedAt === 'number' && optionalString(task.sessionId)
    && optionalString(task.source) && optionalRecord(task.metadata))) {
    return { bundle: null, error: 'Bundle task data is malformed.' };
  }
  if (!value.events.every(event => typeof event.id === 'string'
    && typeof event.timestamp === 'number' && typeof event.agentId === 'string'
    && typeof event.agentName === 'string' && typeof event.agentColor === 'string'
    && typeof event.type === 'string' && typeof event.message === 'string'
    && optionalString(event.sessionId) && optionalRecord(event.metadata))) {
    return { bundle: null, error: 'Bundle event data is malformed.' };
  }
  if (!value.agents.every(agent => typeof agent.id === 'string'
    && typeof agent.status === 'string' && nullableString(agent.currentTask))) {
    return { bundle: null, error: 'Bundle agent data is malformed.' };
  }
  return { bundle: sanitizeValue(value) as DebugBundle, error: null };
}
