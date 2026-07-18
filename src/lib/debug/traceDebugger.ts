import type { AgentTraceRow } from '@/lib/supabase/types';
import type { AgentCallAttempt } from '@/store/debugStore';
import type { AgentRole, AgentStatus, SimEvent, SimTask } from '@/types';
import { traceTaskTitle } from './operationsLens';

export interface TraceAnomaly {
  signature: string;
  summary: string;
  hint: string;
  severity: 'warning' | 'error';
}

export interface BundleAgent {
  id: AgentRole;
  status: AgentStatus;
  currentTask: string | null;
}

export interface TraceDebugBundle {
  schemaVersion: 1;
  exportedAt: string;
  sessionId: string;
  traces: AgentTraceRow[];
  calls: AgentCallAttempt[];
  tasks: SimTask[];
  events: SimEvent[];
  agents: BundleAgent[];
}

const SENSITIVE_KEY = /api[_-]?key|apikey|authorization|credential|password|secret|service[_-]?role|token|bearer|private[_-]?key/i;
const norm = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, ' ') : '';
const short = (value: string, max = 44) => value.length > max ? `${value.slice(0, max - 3)}...` : value;

function safeString(value: string): string {
  return value
    .replace(/sk-(?:ant-)?[A-Za-z0-9_-]{8,}/gi, '[REDACTED]')
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/gi, '[REDACTED]')
    .replace(/bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, '[REDACTED_JWT]')
    .replace(/((?:api[_-]?key|authorization|credential|password|secret|service[_-]?role|token)\s*[:=]\s*)[^\s,;"'}]+/gi, '$1[REDACTED]');
}

/** Redacts recursively on export AND import; input data is never mutated. */
export function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[TRUNCATED]';
  if (typeof value === 'string') return safeString(value).slice(0, 2000);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 200).map(item => sanitizeValue(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 60).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitizeValue(item, depth + 1),
    ]));
  }
  return null;
}

export function mergeTraces(remote: AgentTraceRow[], local: AgentTraceRow[]): AgentTraceRow[] {
  const withoutMirroredLocal = local.filter(item => !remote.some(row => row.trace_type === item.trace_type
      && row.session_id === item.session_id
      && row.agent_id === item.agent_id
      && norm(traceTaskTitle(row)) === norm(traceTaskTitle(item))
      && Math.abs(Date.parse(row.created_at) - Date.parse(item.created_at)) < 60_000));
  return [...remote, ...withoutMirroredLocal]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, 100);
}

export function detectTraceAnomalies(
  sessionId: string,
  traces: AgentTraceRow[],
  calls: AgentCallAttempt[],
): TraceAnomaly[] {
  const anomalies: TraceAnomaly[] = [];
  const add = (type: string, key: string, summary: string, hint: string, severity: TraceAnomaly['severity'] = 'warning') => {
    anomalies.push({ signature: `${sessionId}|${type}|${norm(key)}`, summary, hint, severity });
  };

  for (const call of calls) {
    const label = `${call.role}: ${short(call.taskTitle)}`;
    if (call.traceRecorded === false) {
      add('trace_not_recorded', `${call.role}|${call.taskTitle}|${call.startedAt}`, `Trace not recorded for ${label}.`,
        call.provider === 'mock' ? 'Mock mode is expected; enable live tracing only when intended.' : 'Check Supabase trace RLS/server configuration and refresh.');
    }
    const hasLlmCall = traces.some(trace => trace.trace_type === 'llm_call'
      && trace.agent_id === call.role
      && norm(traceTaskTitle(trace)) === norm(call.taskTitle)
      && Math.abs(Date.parse(trace.created_at) - call.startedAt) < 120_000);
    if (!hasLlmCall && (call.completedAt || Date.now() - call.startedAt >= 10_000)) {
      add('missing_llm_call', `${call.role}|${call.taskTitle}|${call.startedAt}`, `Ask ${call.role} completed without an llm_call trace.`,
        'Refresh traces, then inspect the route fallback and trace insert status.', 'error');
    }
  }

  for (const trace of traces) {
    const title = traceTaskTitle(trace) || 'untitled task';
    if (trace.metadata?.traceRecorded === false && !calls.some(call => call.role === trace.agent_id
      && norm(call.taskTitle) === norm(title) && call.traceRecorded === false)) {
      add('trace_not_recorded', `${trace.agent_id}|${title}|${trace.id}`, `Trace not recorded for ${trace.agent_id}: ${short(title)}.`,
        'Check configuration or keep using the safe mock path.');
    }
    if (trace.trace_type === 'handoff' && trace.agent_id === 'planner') {
      const target = typeof trace.metadata?.target_agent === 'string' ? trace.metadata.target_agent : '';
      const decision = traces.some(candidate => candidate.trace_type === 'decision'
        && candidate.agent_id === target
        && norm(traceTaskTitle(candidate)) === norm(title)
        && Date.parse(candidate.created_at) >= Date.parse(trace.created_at) - 1000);
      if (!decision) {
        add('missing_decision', `${target}|${title}`, `Planner handoff to ${target || 'an agent'} has no decision: ${short(title)}.`,
          'Allow the mini workflow to start, then refresh and inspect assignment.');
      }
    }
    if (typeof trace.latency_ms === 'number' && trace.latency_ms >= 10_000) {
      add('high_latency', trace.id, `${trace.agent_id} ${trace.trace_type} took ${trace.latency_ms}ms.`,
        'Check network/provider health and keep the timeout/fallback enabled.');
    }
    const status = trace.metadata?.finalStatus ?? trace.metadata?.approvalStatus;
    if (typeof status === 'string' && ['failed', 'needs_more_testing', 'changes_requested', 'needs_more_info'].includes(status)) {
      add('failed_status', `${trace.agent_id}|${title}|${status}`, `${trace.agent_id} reported ${status}: ${short(title)}.`,
        'Review the result and route a focused follow-up to developer, reviewer, or QA.', status === 'failed' ? 'error' : 'warning');
    }
  }

  return [...new Map(anomalies.map(item => [item.signature, item])).values()].slice(0, 30);
}

export function createSanitizedBundle(bundle: TraceDebugBundle): TraceDebugBundle {
  return sanitizeValue(bundle) as TraceDebugBundle;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

const ROLES = ['planner', 'architect', 'developer', 'reviewer', 'qa'];
const TRACE_TYPES = ['llm_call', 'handoff', 'decision', 'tool_use'];
const TASK_STATUSES = ['backlog', 'in_progress', 'review', 'done'];
const PRIORITIES = ['low', 'medium', 'high'];
const EVENT_TYPES = ['task', 'meeting', 'chat', 'system', 'review', 'planning'];
const AGENT_STATUSES = ['idle', 'walking', 'thinking', 'coding', 'reviewing', 'testing', 'meeting', 'blocked'];
const isString = (value: unknown, max = 4000): value is string => typeof value === 'string' && value.length <= max;
const isDate = (value: unknown): boolean => isString(value, 100) && Number.isFinite(Date.parse(value));
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const optional = (value: unknown, check: (item: unknown) => boolean) => value === undefined || check(value);
const nullable = (value: unknown, check: (item: unknown) => boolean) => value === null || check(value);
const isMetadata = (value: unknown) => value === null || isRecord(value);
const inList = (value: unknown, list: string[]) => typeof value === 'string' && list.includes(value);

/** Validates a conservative, versioned read-only analysis payload. */
export function parseTraceBundle(raw: string): { bundle?: TraceDebugBundle; error?: string } {
  if (raw.length > 1_500_000) return { error: 'Bundle is too large (max 1.5 MB).' };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { error: 'Invalid JSON bundle. No data was imported.' };
  }
  if (!isRecord(value) || value.schemaVersion !== 1) {
    return { error: 'Unsupported bundle schema version.' };
  }
  if (!isString(value.sessionId, 100) || !value.sessionId.trim() || !isDate(value.exportedAt)
    || !Array.isArray(value.traces) || !Array.isArray(value.calls)
    || !Array.isArray(value.tasks) || !Array.isArray(value.events) || !Array.isArray(value.agents)) {
    return { error: 'Bundle is missing required analysis fields.' };
  }
  if (value.traces.length > 200 || value.calls.length > 200 || value.tasks.length > 200
    || value.events.length > 200 || value.agents.length > 10) {
    return { error: 'Bundle exceeds supported analysis limits.' };
  }
  const validTraces = value.traces.every(trace => isRecord(trace)
    && isString(trace.id, 100) && trace.session_id === value.sessionId
    && inList(trace.agent_id, ROLES) && inList(trace.trace_type, TRACE_TYPES)
    && nullable(trace.input_tokens, isNumber) && nullable(trace.output_tokens, isNumber)
    && nullable(trace.latency_ms, isNumber) && nullable(trace.model, item => isString(item, 200))
    && isMetadata(trace.metadata) && isDate(trace.created_at));
  if (!validTraces) return { error: 'Bundle contains malformed traces.' };

  const validCalls = value.calls.every(call => isRecord(call)
    && isString(call.id, 100) && inList(call.role, ROLES) && isString(call.taskTitle)
    && call.sessionId === value.sessionId && isNumber(call.startedAt)
    && optional(call.completedAt, isNumber)
    && optional(call.provider, item => inList(item, ['mock', 'claude']))
    && optional(call.traceRecorded, item => typeof item === 'boolean')
    && optional(call.failed, item => typeof item === 'boolean'));
  const validTasks = value.tasks.every(task => isRecord(task)
    && isString(task.id, 100) && isString(task.title) && isString(task.description)
    && nullable(task.assignedTo, item => inList(item, ROLES))
    && inList(task.status, TASK_STATUSES) && inList(task.priority, PRIORITIES)
    && isNumber(task.createdAt) && isNumber(task.updatedAt)
    && optional(task.sessionId, item => isString(item, 100))
    && optional(task.origin, item => inList(item, ['simulation', 'planner-generated', 'debug-finding']))
    && optional(task.localOnly, item => typeof item === 'boolean'));
  const validEvents = value.events.every(event => isRecord(event)
    && isString(event.id, 100) && isNumber(event.timestamp) && inList(event.agentId, ROLES)
    && isString(event.agentName, 100) && isString(event.agentColor, 100)
    && inList(event.type, EVENT_TYPES) && isString(event.message)
    && optional(event.sessionId, item => isString(item, 100))
    && optional(event.metadata, isMetadata)
    && optional(event.localOnly, item => typeof item === 'boolean'));
  const validAgents = value.agents.every(agent => isRecord(agent)
    && inList(agent.id, ROLES) && inList(agent.status, AGENT_STATUSES)
    && nullable(agent.currentTask, item => isString(item)));
  if (!validCalls || !validTasks || !validEvents || !validAgents) {
    return { error: 'Bundle contains malformed analysis context.' };
  }
  return { bundle: sanitizeValue(value) as TraceDebugBundle };
}
