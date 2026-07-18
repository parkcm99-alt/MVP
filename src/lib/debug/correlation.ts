import type { AgentTraceRow } from '@/lib/supabase/types';
import type { AgentRole, AgentStatus, SimEvent, SimTask } from '@/types';

export interface AgentInvocation {
  id: string;
  sessionId: string;
  agentId: AgentRole;
  taskTitle: string;
  startedAt: number;
  completedAt: number | null;
  provider: 'mock' | 'claude' | null;
  traceRecorded: boolean | null;
}

export interface AgentSnapshot {
  id: AgentRole;
  name: string;
  status: AgentStatus;
  currentTask: string | null;
  completedTasks: number;
}

export interface TraceAnomaly {
  signature: string;
  kind: 'trace_not_recorded' | 'missing_decision' | 'missing_llm_call' | 'high_latency' | 'failed_status';
  summary: string;
  hint: string;
  agentId?: string;
  taskTitle?: string;
}

export interface DebugBundle {
  kind: 'ai-agent-office-debug-bundle';
  schemaVersion: 1;
  exportedAt: string;
  sessionId: string;
  traces: AgentTraceRow[];
  tasks: SimTask[];
  events: SimEvent[];
  agents: AgentSnapshot[];
  invocations: AgentInvocation[];
}

const SENSITIVE_KEY = /(?:api[ _-]?key|authorization|authentication|bearer|service[ _-]?role|secret|password|credential|cookie|private[ _-]?key|token)/i;
const ROLES: readonly AgentRole[] = ['planner', 'architect', 'developer', 'reviewer', 'qa'];
const MAX_ITEMS = 200;

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[\s-]/g, '_');
  if (['input_tokens', 'output_tokens', 'token_count', 'token_usage', 'max_tokens'].includes(normalized)) return false;
  return SENSITIVE_KEY.test(normalized);
}

export function redactText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk-ant-|sk-proj-|sk-|sb_secret_|sbp_)[A-Za-z0-9._-]{8,}/gi, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_JWT]')
    .replace(/((?:api[ _-]?key|authorization|bearer|service[ _-]?role(?:[ _-]?key)?|secret|token|password|credential)\s*[:=]\s*)["']?[^"',\s}\]]+/gi, '$1[REDACTED]')
    .slice(0, 2000);
}

/** Deep allow-safe conversion used on both export and import. */
export function sanitizeUnknown(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === undefined) return null;
  if (typeof value === 'string') return redactText(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map(item => sanitizeUnknown(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 50).map(([key, item]) => [
      redactText(key).slice(0, 100),
      isSensitiveKey(key) ? '[REDACTED]' : sanitizeUnknown(item, depth + 1),
    ]));
  }
  return null;
}

function safeRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function safeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? redactText(value) : fallback;
}

function safeNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value.slice(0, MAX_ITEMS) : [];
}

function safeMetadata(value: unknown): Record<string, unknown> | null {
  const record = safeRecord(sanitizeUnknown(value));
  return record;
}

function parseTrace(value: unknown, index: number): AgentTraceRow | null {
  const row = safeRecord(value);
  if (!row || typeof row.session_id !== 'string' || typeof row.agent_id !== 'string' || typeof row.trace_type !== 'string') return null;
  return {
    id: safeString(row.id, `imported-${index}`), session_id: safeString(row.session_id),
    agent_id: safeString(row.agent_id), trace_type: safeString(row.trace_type),
    input_tokens: nullableNumber(row.input_tokens), output_tokens: nullableNumber(row.output_tokens),
    latency_ms: nullableNumber(row.latency_ms), model: typeof row.model === 'string' ? safeString(row.model) : null,
    metadata: safeMetadata(row.metadata), created_at: safeString(row.created_at, new Date(0).toISOString()),
  };
}

function parseTask(value: unknown, index: number): SimTask | null {
  const task = safeRecord(value);
  if (!task || typeof task.title !== 'string') return null;
  const role = ROLES.includes(task.assignedTo as AgentRole) ? task.assignedTo as AgentRole : null;
  const status = ['backlog', 'in_progress', 'review', 'done'].includes(task.status as string) ? task.status as SimTask['status'] : 'backlog';
  const priority = ['low', 'medium', 'high'].includes(task.priority as string) ? task.priority as SimTask['priority'] : 'medium';
  return {
    id: safeString(task.id, `imported-task-${index}`), title: safeString(task.title), description: safeString(task.description),
    assignedTo: role, status, priority, createdAt: safeNumber(task.createdAt), updatedAt: safeNumber(task.updatedAt),
    sessionId: safeString(task.sessionId) || undefined, localOnly: true,
    origin: task.origin === 'planner-generated' || task.origin === 'debug-finding' ? task.origin : 'simulation',
  };
}

function parseEvent(value: unknown, index: number): SimEvent | null {
  const event = safeRecord(value);
  if (!event || typeof event.message !== 'string') return null;
  const role = ROLES.includes(event.agentId as AgentRole) ? event.agentId as AgentRole : 'planner';
  const type = ['task', 'meeting', 'chat', 'system', 'review', 'planning'].includes(event.type as string) ? event.type as SimEvent['type'] : 'system';
  return {
    id: safeString(event.id, `imported-event-${index}`), timestamp: safeNumber(event.timestamp), agentId: role,
    agentName: safeString(event.agentName, role), agentColor: safeString(event.agentColor, '#64748B'), type,
    message: safeString(event.message), sessionId: safeString(event.sessionId) || undefined,
    metadata: safeMetadata(event.metadata), localOnly: true,
  };
}

function parseAgent(value: unknown): AgentSnapshot | null {
  const agent = safeRecord(value);
  if (!agent || !ROLES.includes(agent.id as AgentRole)) return null;
  const statuses = ['idle', 'walking', 'thinking', 'coding', 'reviewing', 'testing', 'meeting', 'blocked'];
  return {
    id: agent.id as AgentRole, name: safeString(agent.name, agent.id as string),
    status: statuses.includes(agent.status as string) ? agent.status as AgentStatus : 'idle',
    currentTask: typeof agent.currentTask === 'string' ? safeString(agent.currentTask) : null,
    completedTasks: safeNumber(agent.completedTasks),
  };
}

function parseInvocation(value: unknown, index: number): AgentInvocation | null {
  const item = safeRecord(value);
  if (!item || !ROLES.includes(item.agentId as AgentRole) || typeof item.sessionId !== 'string') return null;
  return {
    id: safeString(item.id, `imported-invocation-${index}`), sessionId: safeString(item.sessionId),
    agentId: item.agentId as AgentRole, taskTitle: safeString(item.taskTitle), startedAt: safeNumber(item.startedAt),
    completedAt: nullableNumber(item.completedAt), provider: item.provider === 'mock' || item.provider === 'claude' ? item.provider : null,
    traceRecorded: typeof item.traceRecorded === 'boolean' ? item.traceRecorded : null,
  };
}

/** Reject unknown versions/shapes; imported data is sanitized and never trusted as executable state. */
export function importDebugBundle(raw: string): { bundle: DebugBundle } | { error: string } {
  if (raw.length > 1_000_000) return { error: 'Bundle is too large (max 1 MB).' };
  let unknownValue: unknown;
  try { unknownValue = JSON.parse(raw); } catch { return { error: 'Invalid JSON bundle.' }; }
  const value = safeRecord(unknownValue);
  if (!value || value.kind !== 'ai-agent-office-debug-bundle') return { error: 'Unsupported debug bundle format.' };
  if (value.schemaVersion !== 1) return { error: 'Unsupported schema version. Expected version 1.' };
  if (typeof value.sessionId !== 'string' || !Array.isArray(value.traces)) return { error: 'Bundle is missing required session or trace data.' };
  const traces = stringArray(value.traces).map(parseTrace).filter((item): item is AgentTraceRow => item !== null);
  if (value.traces.length > 0 && traces.length === 0) return { error: 'Bundle contains no valid traces.' };
  return { bundle: {
    kind: 'ai-agent-office-debug-bundle', schemaVersion: 1, exportedAt: safeString(value.exportedAt, new Date(0).toISOString()),
    sessionId: safeString(value.sessionId), traces,
    tasks: stringArray(value.tasks).map(parseTask).filter((item): item is SimTask => item !== null),
    events: stringArray(value.events).map(parseEvent).filter((item): item is SimEvent => item !== null),
    agents: stringArray(value.agents).map(parseAgent).filter((item): item is AgentSnapshot => item !== null),
    invocations: stringArray(value.invocations).map(parseInvocation).filter((item): item is AgentInvocation => item !== null),
  } };
}

export function exportDebugBundle(bundle: DebugBundle): string {
  return JSON.stringify(sanitizeUnknown(bundle), null, 2);
}

export function traceTaskTitle(trace: AgentTraceRow): string {
  const metadata = trace.metadata;
  return typeof metadata?.task_title === 'string' ? metadata.task_title
    : typeof metadata?.taskTitle === 'string' ? metadata.taskTitle : '';
}

export function normalizeMatch(value: string): string {
  return value.toLowerCase().replace(/\[planner-generated\]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function titlesMatch(left: string, right: string): boolean {
  const a = normalizeMatch(left);
  const b = normalizeMatch(right);
  return Boolean(a && b && (a === b || (a.length >= 4 && b.includes(a)) || (b.length >= 4 && a.includes(b))));
}

export function taskMatchesTrace(task: SimTask, trace: AgentTraceRow): boolean {
  const title = traceTaskTitle(trace);
  if (title && titlesMatch(task.title, title)) return true;
  return !title && task.sessionId === trace.session_id && task.assignedTo === trace.agent_id;
}

export function eventMatchesTask(event: SimEvent, task: SimTask): boolean {
  const title = typeof event.metadata?.taskTitle === 'string' ? event.metadata.taskTitle
    : typeof event.metadata?.task_title === 'string' ? event.metadata.task_title
    : typeof event.metadata?.task === 'string' ? event.metadata.task : '';
  return titlesMatch(title || event.message, task.title)
    || (!title && event.sessionId === task.sessionId && event.agentId === task.assignedTo);
}

export function eventMatchesTrace(event: SimEvent, trace: AgentTraceRow): boolean {
  const title = traceTaskTitle(trace);
  return Boolean(title && titlesMatch(event.message, title))
    || (event.sessionId === trace.session_id && event.agentId === trace.agent_id);
}

function timestamp(value: string): number {
  const result = new Date(value).getTime();
  return Number.isFinite(result) ? result : 0;
}

/** Keep immediate local traces while avoiding a second card when Supabase catches up. */
export function mergeTraces(remote: AgentTraceRow[], local: AgentTraceRow[]): AgentTraceRow[] {
  const uniqueLocal = local.filter(item => !remote.some(row =>
    row.session_id === item.session_id && row.agent_id === item.agent_id && row.trace_type === item.trace_type
    && normalizeMatch(traceTaskTitle(row)) === normalizeMatch(traceTaskTitle(item))
    && Math.abs(timestamp(row.created_at) - timestamp(item.created_at)) < 15_000,
  ));
  return [...remote, ...uniqueLocal].sort((a, b) => timestamp(b.created_at) - timestamp(a.created_at)).slice(0, 100);
}

function signature(session: string, kind: TraceAnomaly['kind'], ...parts: string[]): string {
  return [session, kind, ...parts.map(normalizeMatch)].join('|').slice(0, 500);
}

/** Deterministic, local-only diagnostics. They never imply a provider secret or write to Supabase. */
export function detectAnomalies(session: string, traces: AgentTraceRow[], invocations: AgentInvocation[]): TraceAnomaly[] {
  const sessionTraces = traces.filter(trace => trace.session_id === session);
  const calls = invocations.filter(item => item.sessionId === session);
  const results: TraceAnomaly[] = [];
  const add = (anomaly: TraceAnomaly) => {
    if (!results.some(item => item.signature === anomaly.signature)) results.push(anomaly);
  };

  calls.filter(item => item.traceRecorded === false).forEach(item => add({
    signature: signature(session, 'trace_not_recorded', item.agentId, item.taskTitle), kind: 'trace_not_recorded', agentId: item.agentId, taskTitle: item.taskTitle,
    summary: `${item.agentId} 응답의 traceRecorded=false (${item.provider ?? 'unknown'}).`,
    hint: item.provider === 'mock' ? 'Mock 모드에서는 정상입니다. live 검증 시 서버 키와 RLS를 확인하세요.' : '서버 Supabase service role key, RLS와 안전한 Vercel 로그를 확인하세요.',
  }));
  sessionTraces.filter(trace => trace.metadata?.traceRecorded === false).forEach(trace => add({
    signature: signature(session, 'trace_not_recorded', trace.agent_id, traceTaskTitle(trace)), kind: 'trace_not_recorded', agentId: trace.agent_id, taskTitle: traceTaskTitle(trace),
    summary: `${trace.agent_id} trace가 저장되지 않은 것으로 보고되었습니다.`, hint: 'Mock 여부와 서버 trace insert 설정을 확인하세요.',
  }));

  sessionTraces.filter(trace => trace.trace_type === 'handoff' && trace.agent_id === 'planner').forEach(handoff => {
    const target = typeof handoff.metadata?.target_agent === 'string' ? handoff.metadata.target_agent : '';
    const title = traceTaskTitle(handoff);
    const found = sessionTraces.some(trace => trace.trace_type === 'decision'
      && (!target || trace.agent_id === target)
      && titlesMatch(traceTaskTitle(trace), title));
    if (!found) add({
      signature: signature(session, 'missing_decision', target, title), kind: 'missing_decision', agentId: target, taskTitle: title,
    summary: `Planner handoff 후 ${redactText(target) || '담당 agent'}의 decision이 없습니다: ${redactText(title) || '제목 없음'}.`,
      hint: 'Workflow 시작을 잠시 기다린 뒤 Refresh하고 task 배정/trace insert를 확인하세요.',
    });
  });

  calls.filter(item => item.completedAt !== null).forEach(call => {
    const found = sessionTraces.some(trace => trace.trace_type === 'llm_call' && trace.agent_id === call.agentId
      && titlesMatch(traceTaskTitle(trace), call.taskTitle)
      && timestamp(trace.created_at) >= call.startedAt - 2_000
      && timestamp(trace.created_at) <= (call.completedAt ?? call.startedAt) + 30_000);
    if (!found) add({
      signature: signature(session, 'missing_llm_call', call.agentId, call.taskTitle), kind: 'missing_llm_call', agentId: call.agentId, taskTitle: call.taskTitle,
      summary: `Ask ${call.agentId} 호출 뒤 llm_call이 없습니다: ${redactText(call.taskTitle)}.`,
      hint: '응답 fallback 여부를 확인하고 Refresh하세요. 앱은 mock으로 계속 동작합니다.',
    });
  });

  sessionTraces.filter(trace => (trace.latency_ms ?? 0) >= 10_000).forEach(trace => add({
    signature: signature(session, 'high_latency', trace.agent_id, traceTaskTitle(trace), String(trace.latency_ms)), kind: 'high_latency', agentId: trace.agent_id, taskTitle: traceTaskTitle(trace),
    summary: `${trace.agent_id} 호출 지연이 ${trace.latency_ms}ms입니다 (10,000ms 이상).`,
    hint: '입력 크기, 네트워크와 timeout을 확인하고 작은 요청으로 재시도하세요.',
  }));

  sessionTraces.forEach(trace => {
    const value = trace.metadata?.finalStatus ?? trace.metadata?.approvalStatus;
    if (typeof value !== 'string' || !['failed', 'changes_requested', 'needs_more_info', 'needs_more_testing'].includes(value.toLowerCase())) return;
    add({
      signature: signature(session, 'failed_status', trace.agent_id, traceTaskTitle(trace), value), kind: 'failed_status', agentId: trace.agent_id, taskTitle: traceTaskTitle(trace),
      summary: `${trace.agent_id} 검증 상태: ${redactText(value)} (${redactText(traceTaskTitle(trace)) || '제목 없음'}).`,
      hint: '권장 수정과 테스트를 확인한 뒤 Developer/Reviewer에게 후속 작업을 배정하세요.',
    });
  });
  return results;
}

export function summarizeMetadata(metadata: AgentTraceRow['metadata']): string {
  if (!metadata) return 'metadata —';
  const safe = safeMetadata(metadata) ?? {};
  const parts = Object.entries(safe).filter(([key]) => !isSensitiveKey(key)).slice(0, 4).map(([key, value]) => {
    if (Array.isArray(value)) return `${key}: [${value.length}]`;
    if (value && typeof value === 'object') return `${key}: {…}`;
    const text = String(value ?? '—');
    return `${key}: ${text.length > 48 ? `${text.slice(0, 45)}...` : text}`;
  });
  return parts.length ? parts.join(' · ') : 'metadata redacted';
}
