import type { TraceBundle } from '@/lib/debug/types';

const SENSITIVE_KEY = /(?:api[_-]?key|(?:supabase|anon|publishable)[_-]?key|authorization|token|bearer|credential|password|secret|service[_-]?role|private[_-]?key)/i;
const SAFE_TOKEN_METRICS = /^(?:input|output)_?tokens?$/i;

export function redactText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk-ant-|sk-(?:proj-)?|sb_secret_|sbp_|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{8,}/gi, '[REDACTED]')
    .replace(/\b[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_JWT]')
    .replace(/((?:api[_-]?key|authorization|password|secret|service[_-]?role(?:[_-]?key)?|(?:access|refresh)?[_-]?token)\s*[:=]\s*)["']?[^"',\s}\]]+/gi, '$1[REDACTED]');
}

/** Deep clone + redact. Never mutate the live arrays being inspected. */
export function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[TRUNCATED]';
  if (typeof value === 'string') return redactText(value).slice(0, 4000);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 200).map(item => sanitizeValue(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).slice(0, 60).map(([key, item]) => [
        redactText(key).slice(0, 100),
        SENSITIVE_KEY.test(key) && !SAFE_TOKEN_METRICS.test(key)
          ? '[REDACTED]'
          : sanitizeValue(item, depth + 1),
      ]),
    );
  }
  return null;
}

export function safeMetadataText(metadata: Record<string, unknown> | null): string {
  if (!metadata) return 'metadata —';
  const clean = sanitizeValue(metadata) as Record<string, unknown>;
  const parts = Object.entries(clean).slice(0, 4).map(([key, value]) => {
    if (value === '[REDACTED]') return `${key}: [REDACTED]`;
    if (Array.isArray(value)) return `${key}: [${value.length} items]`;
    if (value && typeof value === 'object') return `${key}: {...}`;
    return `${key}: ${String(value ?? '—').slice(0, 70)}`;
  });
  return parts.length ? parts.join(' · ') : 'metadata —';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const ROLES = ['planner', 'architect', 'developer', 'reviewer', 'qa'];
const TRACE_TYPES = ['llm_call', 'handoff', 'decision', 'tool_use'];
const AGENT_STATUSES = ['idle', 'walking', 'thinking', 'coding', 'reviewing', 'testing', 'meeting', 'blocked'];
const TASK_STATUSES = ['backlog', 'in_progress', 'review', 'done'];
const PRIORITIES = ['low', 'medium', 'high'];
const EVENT_TYPES = ['task', 'meeting', 'chat', 'system', 'review', 'planning'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function oneOf(value: unknown, allowed: string[]): boolean { return typeof value === 'string' && allowed.includes(value); }
function finite(value: unknown): boolean { return typeof value === 'number' && Number.isFinite(value); }
function nullableMetric(value: unknown): boolean { return value === null || finite(value); }
function text(value: unknown, max = 4000): boolean { return typeof value === 'string' && value.length <= max; }
function optionalText(value: unknown, max = 4000): boolean { return value === undefined || text(value, max); }
function iso(value: unknown): boolean { return text(value, 64) && Number.isFinite(Date.parse(value as string)); }

/** Strict enough to safely render, intentionally not a write/import format. */
export function parseTraceBundle(raw: string): { bundle: TraceBundle } | { error: string } {
  if (raw.length > 1_000_000) return { error: 'Bundle is too large (max 1 MB).' };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { error: 'Invalid JSON bundle.' }; }
  if (!isObject(parsed)) return { error: 'Bundle must be a JSON object.' };
  if (parsed.schemaVersion !== 1) return { error: 'Unsupported bundle schema version.' };
  if (!text(parsed.sessionId, 64) || !UUID.test(parsed.sessionId as string)) return { error: 'Bundle session is invalid.' };
  if (!iso(parsed.exportedAt)) return { error: 'Bundle export time is invalid.' };
  const limits: Array<[string, number]> = [['traces', 100], ['tasks', 200], ['events', 200], ['agents', 10], ['invocations', 100]];
  for (const [key, limit] of limits) {
    if (!Array.isArray(parsed[key]) || parsed[key].length > limit) return { error: `Invalid bundle ${key} collection.` };
  }
  const traces = parsed.traces as unknown[];
  if (traces.some(trace => !isObject(trace) || !text(trace.id, 100) || trace.session_id !== parsed.sessionId
    || !oneOf(trace.agent_id, ROLES) || !oneOf(trace.trace_type, TRACE_TYPES) || !iso(trace.created_at)
    || !nullableMetric(trace.input_tokens) || !nullableMetric(trace.output_tokens) || !nullableMetric(trace.latency_ms)
    || !(trace.model === null || text(trace.model, 200)) || !(trace.metadata === null || isObject(trace.metadata)))) {
    return { error: 'Bundle contains an invalid trace.' };
  }
  const tasks = parsed.tasks as unknown[];
  if (tasks.some(task => !isObject(task) || !text(task.id, 100) || !text(task.title) || !text(task.description)
    || !(task.assignedTo === null || oneOf(task.assignedTo, ROLES)) || !oneOf(task.status, TASK_STATUSES)
    || !oneOf(task.priority, PRIORITIES) || !finite(task.createdAt) || !finite(task.updatedAt)
    || !optionalText(task.sessionId, 64))) return { error: 'Bundle contains an invalid task.' };
  const events = parsed.events as unknown[];
  if (events.some(event => !isObject(event) || !text(event.id, 100) || !text(event.message) || !finite(event.timestamp)
    || !oneOf(event.agentId, ROLES) || !text(event.agentName, 100) || !text(event.agentColor, 100)
    || !oneOf(event.type, EVENT_TYPES) || !optionalText(event.sessionId, 64))) return { error: 'Bundle contains an invalid event.' };
  const agents = parsed.agents as unknown[];
  if (agents.some(agent => !isObject(agent) || !oneOf(agent.id, ROLES) || !oneOf(agent.status, AGENT_STATUSES))) return { error: 'Bundle contains an invalid agent.' };
  const invocations = parsed.invocations as unknown[];
  if (invocations.some(item => !isObject(item) || !text(item.id, 100) || item.sessionId !== parsed.sessionId
    || !oneOf(item.agentId, ROLES) || !text(item.taskTitle) || !finite(item.calledAt) || !finite(item.completedAt)
    || !(item.provider === null || item.provider === 'mock' || item.provider === 'claude')
    || !(item.traceRecorded === null || typeof item.traceRecorded === 'boolean')
    || !(item.failed === undefined || typeof item.failed === 'boolean'))) return { error: 'Bundle contains an invalid invocation.' };
  return { bundle: sanitizeValue(parsed) as TraceBundle };
}
