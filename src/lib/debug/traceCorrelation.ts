import type { AgentTraceRow } from '@/lib/supabase/types';

export const TRACE_BUNDLE_VERSION = 1;
const SECRET_KEY = /(api[\s_-]*key|authorization|bearer|credential|password|secret|service[\s_-]*role|token)/i;
const SECRET_VALUE = /(bearer\s+[a-z0-9._~+\/-]{8,}|(?:sk|key|token|gh[pousr]|sb_secret)[-_][a-z0-9_-]{12,}|AIza[a-z0-9_-]{20,}|eyJ[a-zA-Z0-9_-]{12,}\.)/i;

export interface TraceAnomaly {
  signature: string;
  kind: 'trace_not_recorded' | 'missing_decision' | 'missing_llm_call' | 'high_latency' | 'failure_status';
  summary: string;
  hint: string;
  agentId: string;
}

export interface TraceBundle {
  schemaVersion: 1;
  exportedAt: string;
  sessionId: string;
  traces: AgentTraceRow[];
}

export function sanitizeJson(value: unknown, key = '', depth = 0): unknown {
  if (depth > 12) return '[TRUNCATED]';
  if (SECRET_KEY.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return SECRET_VALUE.test(value) ? '[REDACTED]' : value;
  if (Array.isArray(value)) return value.map(item => sanitizeJson(item, '', depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([childKey, child]) => [childKey, sanitizeJson(child, childKey, depth + 1)]));
  }
  return value;
}

export function parseTraceBundle(raw: string): TraceBundle {
  if (raw.length > 2_000_000) throw new Error('Bundle is larger than 2 MB.');
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('Bundle must be a JSON object.');
  const bundle = value as Record<string, unknown>;
  if (bundle.schemaVersion !== TRACE_BUNDLE_VERSION) throw new Error('Unsupported bundle schema version.');
  if (typeof bundle.sessionId !== 'string' || bundle.sessionId.length > 500 ||
      typeof bundle.exportedAt !== 'string' || !Number.isFinite(Date.parse(bundle.exportedAt)) ||
      !Array.isArray(bundle.traces)) throw new Error('Bundle fields are invalid.');
  const traces = bundle.traces;
  if (traces.length > 100) throw new Error('Bundle exceeds the 100 trace limit.');
  for (const trace of traces) {
    if (!trace || typeof trace !== 'object') throw new Error('Bundle contains an invalid trace.');
    const row = trace as Record<string, unknown>;
    if (typeof row.id !== 'string' || typeof row.session_id !== 'string' ||
        typeof row.agent_id !== 'string' || typeof row.trace_type !== 'string' ||
        typeof row.created_at !== 'string') throw new Error('Bundle contains an invalid trace shape.');
    if ([row.id, row.session_id, row.agent_id, row.trace_type, row.created_at].some(field => (field as string).length > 500)) {
      throw new Error('Bundle contains an oversized trace field.');
    }
    if (row.session_id !== bundle.sessionId || !Number.isFinite(Date.parse(row.created_at))) {
      throw new Error('Bundle session or timestamp is invalid.');
    }
    for (const field of ['input_tokens', 'output_tokens', 'latency_ms'] as const) {
      if (row[field] !== null && (typeof row[field] !== 'number' || !Number.isFinite(row[field]) || row[field] < 0)) {
        throw new Error(`Bundle ${field} is invalid.`);
      }
    }
    if (row.model !== null && typeof row.model !== 'string') throw new Error('Bundle model is invalid.');
    if (row.metadata !== null && (typeof row.metadata !== 'object' || Array.isArray(row.metadata))) {
      throw new Error('Bundle metadata is invalid.');
    }
  }
  return sanitizeJson(value) as TraceBundle;
}

function meta(trace: AgentTraceRow, key: string): unknown {
  return trace.metadata?.[key];
}

export function detectTraceAnomalies(traces: AgentTraceRow[]): TraceAnomaly[] {
  const ordered = [...traces].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const findings: TraceAnomaly[] = [];
  const add = (trace: AgentTraceRow, kind: TraceAnomaly['kind'], summary: string, hint: string) => {
    const task = String(meta(trace, 'task_title') ?? '');
    const signature = `${kind}:${trace.agent_id}:${task || trace.id}`;
    if (!findings.some(item => item.signature === signature)) findings.push({ signature, kind, summary, hint, agentId: trace.agent_id });
  };

  for (let index = 0; index < ordered.length; index += 1) {
    const trace = ordered[index];
    if (meta(trace, 'traceRecorded') === false || meta(trace, 'trace_recorded') === false) {
      add(trace, 'trace_not_recorded', `${trace.agent_id} 호출 trace가 저장되지 않았습니다.`, 'Supabase 설정·권한을 확인하고 로컬 타임라인과 대조하세요.');
    }
    if (typeof trace.latency_ms === 'number' && trace.latency_ms >= 10_000) {
      add(trace, 'high_latency', `${trace.agent_id} 호출 지연이 ${trace.latency_ms}ms입니다.`, '타임아웃, 모델 부하, 입력 크기를 확인하세요.');
    }
    const status = String(meta(trace, 'finalStatus') ?? meta(trace, 'final_status') ?? meta(trace, 'approvalStatus') ?? meta(trace, 'approval_status') ?? '').toLowerCase();
    if (status && !/^(approved|passed|success|succeeded|completed|ok)$/.test(status)) {
      add(trace, 'failure_status', `${trace.agent_id} 결과 상태가 실패 또는 추가 확인 필요 상태입니다.`, 'Reviewer 또는 QA finding으로 원인과 재현 절차를 확인하세요.');
    }
    if (trace.trace_type === 'handoff' && trace.agent_id === 'planner') {
      const task = meta(trace, 'task_title');
      const hasDecision = ordered.slice(index + 1).some(next => next.trace_type === 'decision' && (!task || meta(next, 'task_title') === task));
      if (!hasDecision) add(trace, 'missing_decision', 'Planner handoff 뒤 decision trace가 없습니다.', '대상 agent가 task를 수락·시작했는지 확인하세요.');
    }
    const isAsk = trace.trace_type === 'tool_use' && /ask[_ -]?agent/i.test(String(meta(trace, 'action') ?? meta(trace, 'tool') ?? ''));
    if (isAsk) {
      const task = meta(trace, 'task_title');
      const hasCall = ordered.slice(index + 1).some(next => next.trace_type === 'llm_call' &&
        next.agent_id === trace.agent_id && (!task || meta(next, 'task_title') === task));
      if (!hasCall) add(trace, 'missing_llm_call', `Ask Agent 뒤 ${trace.agent_id} llm_call trace가 없습니다.`, '네트워크 오류와 API route 로그를 확인한 뒤 재시도하세요.');
    }
  }
  return findings;
}
