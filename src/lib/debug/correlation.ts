import { redactSensitiveText, sanitizeTraceMetadata } from '@/lib/supabase/traces';
import type { AgentTraceRow } from '@/lib/supabase/types';
import type { AgentRole, SimEvent, SimTask } from '@/types';
import type { LlmProvider } from '@/lib/llm/types';

export const TRACE_LIMIT = 100;
export const BUNDLE_SCHEMA = 'agent-office.trace-debug';
export const BUNDLE_VERSION = 1;

const ROLES: AgentRole[] = ['planner', 'architect', 'developer', 'reviewer', 'qa'];
const TRACE_TYPES = ['llm_call', 'handoff', 'decision', 'tool_use'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AgentCallRecord {
  id: string;
  sessionId: string;
  agentId: AgentRole;
  taskTitle: string;
  calledAt: number;
  completedAt?: number;
  provider?: LlmProvider;
  traceRecorded?: boolean;
  model?: string | null;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  failed?: boolean;
}

export interface TraceAnomaly {
  kind: 'trace_not_recorded' | 'missing_decision' | 'missing_llm_call' | 'slow_call' | 'failed_outcome';
  signature: string;
  summary: string;
  hint: string;
}

export interface AgentSnapshot {
  id: AgentRole;
  name: string;
  status: string;
  currentTask: string | null;
  completedTasks: number;
}

export interface TraceDebugBundle {
  schema: typeof BUNDLE_SCHEMA;
  schemaVersion: typeof BUNDLE_VERSION;
  exportedAt: string;
  sessionId: string;
  traces: AgentTraceRow[];
  tasks: SimTask[];
  events: SimEvent[];
  agents: AgentSnapshot[];
  calls: AgentCallRecord[];
}

function safeString(value: unknown, max = 600): string {
  return typeof value === 'string' ? redactSensitiveText(value).slice(0, max) : '';
}

function safeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function safeRole(value: unknown): AgentRole | null {
  return typeof value === 'string' && ROLES.includes(value as AgentRole) ? value as AgentRole : null;
}

function metadataString(metadata: Record<string, unknown> | null | undefined, ...keys: string[]): string {
  if (!metadata) return '';
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) return safeString(value.trim(), 240);
  }
  return '';
}

export function traceTaskTitle(trace: AgentTraceRow): string {
  return metadataString(trace.metadata, 'task_title', 'taskTitle', 'task', 'title');
}

export function eventTaskTitle(event: SimEvent): string {
  return metadataString(event.metadata, 'task_title', 'taskTitle', 'task', 'title');
}

export function normalizeMatch(value: string): string {
  return value.toLowerCase().replace(/\[planner-generated\]/g, '').replace(/\s+/g, ' ').trim();
}

function titlesOverlap(left: string, right: string): boolean {
  const a = normalizeMatch(left);
  const b = normalizeMatch(right);
  return Boolean(a && b && (a === b || (a.length >= 5 && b.includes(a)) || (b.length >= 5 && a.includes(b))));
}

export function taskMatchesTrace(task: SimTask, trace: AgentTraceRow): boolean {
  return titlesOverlap(task.title, traceTaskTitle(trace));
}

export function taskMatchesEvent(task: SimTask, event: SimEvent): boolean {
  const metadata = event.metadata;
  if (metadata && (metadata.taskId === task.id || metadata.task_id === task.id)) return true;
  return titlesOverlap(task.title, eventTaskTitle(event)) || titlesOverlap(task.title, event.message);
}

export function eventMatchesTrace(event: SimEvent, trace: AgentTraceRow): boolean {
  const title = traceTaskTitle(trace);
  if (title && (titlesOverlap(title, eventTaskTitle(event)) || titlesOverlap(title, event.message))) return true;
  return Boolean(
    !title && event.sessionId === trace.session_id && event.agentId === trace.agent_id,
  );
}

export function mergeRecentTraces(remote: AgentTraceRow[], local: AgentTraceRow[]): AgentTraceRow[] {
  const byId = new Map<string, AgentTraceRow>();
  // The browser uses the request traceId too; a successful remote row replaces its local mirror.
  [...local, ...remote].forEach(trace => byId.set(trace.id, trace));
  return [...byId.values()]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, TRACE_LIMIT);
}

export interface TraceSessionGroup {
  sessionId: string;
  traces: AgentTraceRow[];
  agents: Array<{ value: string; count: number }>;
  types: Array<{ value: string; count: number }>;
  tasks: Array<{ value: string; count: number }>;
  latestAt: string;
}

function counts(values: string[]): Array<{ value: string; count: number }> {
  const map = new Map<string, number>();
  values.filter(Boolean).forEach(value => map.set(value, (map.get(value) ?? 0) + 1));
  return [...map.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export function groupTraceSessions(traces: AgentTraceRow[]): TraceSessionGroup[] {
  const map = new Map<string, AgentTraceRow[]>();
  traces.forEach(trace => {
    const rows = map.get(trace.session_id) ?? [];
    rows.push(trace);
    map.set(trace.session_id, rows);
  });
  return [...map.entries()].map(([sessionId, items]) => {
    const sorted = [...items].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return {
      sessionId,
      traces: sorted,
      agents: counts(sorted.map(trace => trace.agent_id)),
      types: counts(sorted.map(trace => trace.trace_type)),
      tasks: counts(sorted.map(traceTaskTitle)),
      latestAt: sorted[0]?.created_at ?? new Date(0).toISOString(),
    };
  }).sort((a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime());
}

function signature(...parts: string[]): string {
  return parts.map(part => normalizeMatch(safeString(part, 180))).join('|');
}

export function detectTraceAnomalies(traces: AgentTraceRow[], calls: AgentCallRecord[]): TraceAnomaly[] {
  const anomalies = new Map<string, TraceAnomaly>();
  const add = (anomaly: TraceAnomaly) => anomalies.set(anomaly.signature, anomaly);

  calls.filter(call => call.traceRecorded === false).forEach(call => {
    const sig = signature('trace_not_recorded', call.sessionId, call.agentId, call.taskTitle, call.id);
    add({
      kind: 'trace_not_recorded', signature: sig,
      summary: `${call.agentId} 호출의 traceRecorded가 false입니다.`,
      hint: call.provider === 'mock'
        ? 'Mock mode에서는 서버 trace가 저장되지 않습니다. Live가 필요할 때만 환경변수를 확인하세요.'
        : 'Supabase 연결/RLS와 서버 service role 설정을 확인하고 Refresh 하세요.',
    });
  });

  traces.filter(trace => trace.metadata?.traceRecorded === false).forEach(trace => {
    const sig = signature('trace_not_recorded', trace.session_id, trace.agent_id, traceTaskTitle(trace), trace.id);
    add({ kind: 'trace_not_recorded', signature: sig,
      summary: `${trace.agent_id} trace가 저장되지 않았다고 보고했습니다.`,
      hint: 'Supabase 연결과 trace insert 권한을 확인하세요.' });
  });

  traces.filter(trace => trace.agent_id === 'planner' && trace.trace_type === 'handoff').forEach(handoff => {
    const title = traceTaskTitle(handoff);
    const target = metadataString(handoff.metadata, 'target_agent');
    const handoffAt = new Date(handoff.created_at).getTime();
    const found = traces.some(trace => trace.trace_type === 'decision'
      && trace.agent_id === target
      && titlesOverlap(traceTaskTitle(trace), title)
      && new Date(trace.created_at).getTime() >= handoffAt - 1000);
    if (!found) {
      const sig = signature('missing_decision', handoff.session_id, target, title);
      add({ kind: 'missing_decision', signature: sig,
        summary: `Planner handoff 뒤 ${target || '담당 agent'} decision이 없습니다: ${title || '제목 없음'}`,
        hint: 'Mini workflow가 진행 중일 수 있습니다. 잠시 후 Refresh하고 담당 task 상태를 확인하세요.' });
    }
  });

  calls.filter(call => call.completedAt || Date.now() - call.calledAt >= 10_000).forEach(call => {
    const found = traces.some(trace => trace.trace_type === 'llm_call'
      && trace.agent_id === call.agentId
      && (trace.id === call.id || (trace.session_id === call.sessionId && titlesOverlap(traceTaskTitle(trace), call.taskTitle)
        && new Date(trace.created_at).getTime() >= call.calledAt - 1000)));
    if (!found) {
      const sig = signature('missing_llm_call', call.sessionId, call.agentId, call.taskTitle, call.id);
      add({ kind: 'missing_llm_call', signature: sig,
        summary: `Ask ${call.agentId} 호출 뒤 llm_call이 없습니다: ${call.taskTitle}`,
        hint: '요청 실패 또는 trace 조회 지연을 확인하고 Refresh 하세요. Mock fallback은 앱을 계속 실행합니다.' });
    }
  });

  traces.filter(trace => typeof trace.latency_ms === 'number' && trace.latency_ms >= 10_000).forEach(trace => {
    const sig = signature('slow_call', trace.session_id, trace.id);
    add({ kind: 'slow_call', signature: sig,
      summary: `${trace.agent_id} ${trace.trace_type} 지연이 ${trace.latency_ms}ms입니다.`,
      hint: '네트워크와 timeout 설정을 확인하고 작은 요청으로 다시 시도하세요.' });
  });

  traces.forEach(trace => {
    const status = metadataString(trace.metadata, 'finalStatus', 'approvalStatus', 'final_status', 'approval_status').toLowerCase();
    if (!['failed', 'changes_requested', 'needs_more_info', 'needs_more_testing'].includes(status)) return;
    const sig = signature('failed_outcome', trace.session_id, trace.id, status);
    add({ kind: 'failed_outcome', signature: sig,
      summary: `${trace.agent_id} 결과에 후속 조치가 필요합니다: ${status}.`,
      hint: '관련 task와 권장사항을 검토한 뒤 Developer, Reviewer 또는 QA에 다시 전달하세요.' });
  });

  return [...anomalies.values()];
}

function cleanTrace(value: unknown): AgentTraceRow | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const id = safeString(row.id, 80);
  const session = safeString(row.session_id, 80);
  const type = safeString(row.trace_type, 30);
  const agent = safeRole(row.agent_id);
  const created = safeString(row.created_at, 40);
  if (!id || !UUID.test(session) || !agent || !TRACE_TYPES.includes(type) || Number.isNaN(Date.parse(created))) return null;
  return {
    id, session_id: session, agent_id: agent, trace_type: type,
    input_tokens: safeNumber(row.input_tokens), output_tokens: safeNumber(row.output_tokens),
    latency_ms: safeNumber(row.latency_ms), model: safeString(row.model, 120) || null,
    metadata: row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? sanitizeTraceMetadata(row.metadata as Record<string, unknown>) : null,
    created_at: created,
  };
}

function cleanTask(value: unknown): SimTask | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const status = safeString(row.status, 20);
  const priority = safeString(row.priority, 20);
  if (!['backlog', 'in_progress', 'review', 'done'].includes(status) || !['low', 'medium', 'high'].includes(priority)) return null;
  const title = safeString(row.title, 240);
  if (!title) return null;
  return {
    id: safeString(row.id, 80) || `import-${title}`,
    title,
    description: safeString(row.description, 1000),
    assignedTo: safeRole(row.assignedTo),
    status: status as SimTask['status'],
    priority: priority as SimTask['priority'],
    createdAt: safeNumber(row.createdAt) ?? 0,
    updatedAt: safeNumber(row.updatedAt) ?? 0,
    sessionId: safeString(row.sessionId, 80) || undefined,
    localOnly: true,
    source: row.source === 'debug-finding' ? 'debug-finding' : row.source === 'planner-generated' ? 'planner-generated' : 'simulation',
  };
}

function cleanEvent(value: unknown): SimEvent | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const role = safeRole(row.agentId);
  const type = safeString(row.type, 20);
  if (!role || !['task', 'meeting', 'chat', 'system', 'review', 'planning'].includes(type)) return null;
  return {
    id: safeString(row.id, 100), timestamp: safeNumber(row.timestamp) ?? 0,
    agentId: role, agentName: safeString(row.agentName, 80), agentColor: safeString(row.agentColor, 30),
    type: type as SimEvent['type'], message: safeString(row.message, 1000),
    sessionId: safeString(row.sessionId, 80) || undefined,
    metadata: row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? sanitizeTraceMetadata(row.metadata as Record<string, unknown>) : null,
    localOnly: true,
  };
}

function cleanCall(value: unknown): AgentCallRecord | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const agentId = safeRole(row.agentId);
  const sessionId = safeString(row.sessionId, 80);
  if (!agentId || !UUID.test(sessionId)) return null;
  return {
    id: safeString(row.id, 80), sessionId, agentId, taskTitle: safeString(row.taskTitle, 240),
    calledAt: safeNumber(row.calledAt) ?? 0,
    completedAt: safeNumber(row.completedAt) ?? undefined,
    provider: row.provider === 'claude' || row.provider === 'mock' ? row.provider : undefined,
    traceRecorded: typeof row.traceRecorded === 'boolean' ? row.traceRecorded : undefined,
    model: safeString(row.model, 120) || null,
    latencyMs: safeNumber(row.latencyMs), inputTokens: safeNumber(row.inputTokens), outputTokens: safeNumber(row.outputTokens),
    failed: row.failed === true,
  };
}

function cleanAgent(value: unknown): AgentSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const id = safeRole(row.id);
  if (!id) return null;
  return { id, name: safeString(row.name, 80), status: safeString(row.status, 30),
    currentTask: safeString(row.currentTask, 240) || null, completedTasks: safeNumber(row.completedTasks) ?? 0 };
}

function compact<T>(values: unknown[], clean: (value: unknown) => T | null, max: number): T[] {
  return values.slice(0, max).map(clean).filter((value): value is T => value !== null);
}

export function createSanitizedBundle(
  sessionId: string, traces: AgentTraceRow[], tasks: SimTask[], events: SimEvent[],
  agents: AgentSnapshot[], calls: AgentCallRecord[],
): TraceDebugBundle {
  return {
    schema: BUNDLE_SCHEMA,
    schemaVersion: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    sessionId: safeString(sessionId, 80),
    traces: compact(traces, cleanTrace, TRACE_LIMIT),
    tasks: compact(tasks, cleanTask, 200),
    events: compact(events, cleanEvent, 200),
    agents: compact(agents, cleanAgent, 5),
    calls: compact(calls, cleanCall, TRACE_LIMIT),
  };
}

export function parseSanitizedBundle(raw: string): { bundle: TraceDebugBundle } | { error: string } {
  if (raw.length > 1_000_000) return { error: 'Bundle is too large (max 1 MB).' };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { error: 'Invalid JSON bundle.' }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: 'Invalid bundle object.' };
  const value = parsed as Record<string, unknown>;
  if (value.schema !== BUNDLE_SCHEMA || value.schemaVersion !== BUNDLE_VERSION) {
    return { error: 'Unsupported bundle schema version.' };
  }
  const sessionId = safeString(value.sessionId, 80);
  if (!UUID.test(sessionId) || !Array.isArray(value.traces) || value.traces.length > TRACE_LIMIT
    || !Array.isArray(value.tasks) || value.tasks.length > 200
    || !Array.isArray(value.events) || value.events.length > 200
    || !Array.isArray(value.agents) || value.agents.length > 5
    || !Array.isArray(value.calls) || value.calls.length > TRACE_LIMIT) {
    return { error: 'Bundle structure or limits are invalid.' };
  }
  const traces = compact(value.traces, cleanTrace, TRACE_LIMIT);
  if (traces.length !== value.traces.length || traces.some(trace => trace.session_id !== sessionId)) {
    return { error: 'Bundle contains invalid or cross-session traces.' };
  }
  const tasks = compact(value.tasks, cleanTask, 200);
  const events = compact(value.events, cleanEvent, 200);
  const agents = compact(value.agents, cleanAgent, 5);
  const calls = compact(value.calls, cleanCall, TRACE_LIMIT);
  if (tasks.length !== value.tasks.length || events.length !== value.events.length
    || agents.length !== value.agents.length || calls.length !== value.calls.length
    || calls.some(call => call.sessionId !== sessionId)) {
    return { error: 'Bundle contains invalid analysis records.' };
  }
  return { bundle: {
    schema: BUNDLE_SCHEMA, schemaVersion: BUNDLE_VERSION,
    exportedAt: safeString(value.exportedAt, 40) || new Date().toISOString(),
    sessionId, traces, tasks, events, agents, calls,
  } };
}

export function summarizeTraceMetadata(metadata: AgentTraceRow['metadata']): string {
  const safe = sanitizeTraceMetadata(metadata);
  if (!safe || Object.keys(safe).length === 0) return 'metadata —';
  return Object.entries(safe).slice(0, 4).map(([key, value]) => {
    const part = typeof value === 'string' ? value.slice(0, 48)
      : typeof value === 'number' || typeof value === 'boolean' ? String(value)
        : Array.isArray(value) ? `[${value.length}]` : '{…}';
    return `${key}: ${part}`;
  }).join(' · ');
}
