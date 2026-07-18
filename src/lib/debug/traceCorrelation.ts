import type { AgentTraceRow } from '@/lib/supabase/types';
import { traceTaskTitle, titlesMatch } from './operationsLens';

export interface TraceAnomaly {
  signature: string;
  summary: string;
  hint: string;
  role: 'reviewer' | 'qa';
}

export interface SanitizedTraceBundle {
  schemaVersion: 1;
  exportedAt: string;
  sessionId: string;
  traces: AgentTraceRow[];
}

export const TRACE_LIMIT = 100;
export const MAX_IMPORT_BYTES = 2_000_000;
const TRACE_TYPES = new Set(['llm_call', 'handoff', 'decision', 'tool_use']);
const SECRET_VALUE = /(?:sk-(?:ant-|proj-)?[a-z0-9_-]{12,}|gh[pousr]_[a-z0-9_]{12,}|github_pat_[a-z0-9_]{12,}|sb_(?:secret|publishable)_[a-z0-9_-]{12,}|bearer\s+\S+|eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_.-]{10,}|(?:api[_ -]?key|service[_ -]?role|authorization|password|secret|(?:access|refresh)[_ -]?token)\s*[:=]\s*\S+)/i;

function isSecretKey(key: string): boolean {
  const value = key.toLowerCase().replace(/[\s-]+/g, '_');
  if (value === 'input_tokens' || value === 'output_tokens') return false;
  return /api_?key|authorization|bearer|credential|password|secret|service_?role|(?:^|_)token(?:$|_)|access_?token|refresh_?token|private_?key|anon_?key/.test(value);
}

/** Redaction is recursive and bounded so an imported bundle cannot become a large object graph. */
export function sanitizeTraceValue(value: unknown, key = '', depth = 0): unknown {
  if (isSecretKey(key)) return '[REDACTED]';
  if (typeof value === 'string') return SECRET_VALUE.test(value) ? '[REDACTED]' : value.slice(0, 2000);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || value === null) return value;
  if (depth >= 6) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, TRACE_LIMIT).map(item => sanitizeTraceValue(item, '', depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 80)
      .filter(([entryKey]) => !['__proto__', 'constructor', 'prototype'].includes(entryKey))
      .map(([entryKey, entryValue]) => [entryKey.slice(0, 100), sanitizeTraceValue(entryValue, entryKey, depth + 1)]));
  }
  return null;
}

function validNumber(value: unknown): boolean {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000_000);
}

function validTrace(value: unknown, sessionId: string): value is AgentTraceRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Partial<AgentTraceRow>;
  return typeof row.id === 'string' && row.id.length > 0 && row.id.length <= 200
    && row.session_id === sessionId
    && typeof row.agent_id === 'string' && row.agent_id.length > 0 && row.agent_id.length <= 80
    && typeof row.trace_type === 'string' && TRACE_TYPES.has(row.trace_type)
    && validNumber(row.input_tokens) && validNumber(row.output_tokens) && validNumber(row.latency_ms)
    && (row.model === null || (typeof row.model === 'string' && row.model.length <= 200))
    && typeof row.created_at === 'string' && Number.isFinite(Date.parse(row.created_at))
    && (row.metadata === null || (Boolean(row.metadata) && typeof row.metadata === 'object' && !Array.isArray(row.metadata)));
}

export function makeSanitizedBundle(sessionId: string, traces: AgentTraceRow[]): SanitizedTraceBundle {
  return sanitizeTraceValue({
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    sessionId,
    traces: traces.slice(0, TRACE_LIMIT),
  }) as SanitizedTraceBundle;
}

export function parseSanitizedBundle(text: string): SanitizedTraceBundle | null {
  try {
    const raw: unknown = JSON.parse(text);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const bundle = raw as Partial<SanitizedTraceBundle>;
    if (bundle.schemaVersion !== 1
      || typeof bundle.sessionId !== 'string'
      || !/^[a-z0-9_-]{1,100}$/i.test(bundle.sessionId)
      || typeof bundle.exportedAt !== 'string'
      || !Number.isFinite(Date.parse(bundle.exportedAt))
      || !Array.isArray(bundle.traces)
      || bundle.traces.length > TRACE_LIMIT) return null;
    const safe = sanitizeTraceValue(bundle.traces) as unknown[];
    if (!safe.every(trace => validTrace(trace, bundle.sessionId!))) return null;
    return { schemaVersion: 1, exportedAt: bundle.exportedAt, sessionId: bundle.sessionId, traces: safe as AgentTraceRow[] };
  } catch {
    return null;
  }
}

function stablePart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 120) || 'unknown';
}

/** Session is deliberately not part of the signature; callers scope it to the selected session. */
export function findTraceAnomalies(traces: AgentTraceRow[]): TraceAnomaly[] {
  const sorted = [...traces].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const found = new Map<string, TraceAnomaly>();
  const add = (anomaly: TraceAnomaly) => { if (!found.has(anomaly.signature)) found.set(anomaly.signature, anomaly); };

  for (const [index, trace] of sorted.entries()) {
    const meta = trace.metadata ?? {};
    const role = stablePart(trace.agent_id);
    const title = traceTaskTitle(trace);
    const subject = `${role}:${stablePart(title)}`;
    if (meta.traceRecorded === false || meta.traceRecorded === 'false') {
      add({ signature: `trace_not_recorded:${subject}`, summary: `${trace.agent_id} trace가 기록되지 않았습니다.`, hint: 'Supabase 설정과 서버 service role 권한을 확인하세요.', role: 'reviewer' });
    }
    if ((trace.latency_ms ?? 0) >= 10_000) {
      add({ signature: `high_latency:${subject}`, summary: `${trace.agent_id} 호출 지연이 10초 이상입니다.`, hint: 'timeout, 모델 가용성, 네트워크 상태를 확인하세요.', role: 'qa' });
    }
    const status = String(meta.finalStatus ?? meta.final_status ?? meta.approvalStatus ?? meta.approval_status ?? '').toLowerCase();
    if (['failed', 'changes_requested', 'needs_more_info', 'needs_more_testing'].includes(status)) {
      add({ signature: `result_status:${subject}:${status}`, summary: `${trace.agent_id} 결과가 ${status} 상태입니다.`, hint: '권장 변경 또는 실패 테스트를 후속 task로 추적하세요.', role: status === 'failed' ? 'qa' : 'reviewer' });
    }
    if (trace.trace_type === 'handoff' && trace.agent_id === 'planner') {
      const target = typeof meta.target_agent === 'string' ? meta.target_agent : '';
      const hasDecision = sorted.slice(index + 1).some(next => next.trace_type === 'decision'
        && (!target || next.agent_id === target)
        && (!title || titlesMatch(traceTaskTitle(next), title)));
      if (!hasDecision) add({ signature: `missing_decision:${stablePart(target)}:${stablePart(title)}`, summary: `Planner handoff 뒤 ${target || '대상 agent'} decision이 없습니다.`, hint: '대상 agent의 task 시작과 decision trace 기록을 확인하세요.', role: 'qa' });
    }
    const action = String(meta.action ?? meta.event ?? '').toLowerCase();
    if (meta.askAgent === true || action.includes('ask_agent')) {
      const at = Date.parse(trace.created_at);
      const hasCall = sorted.some(next => next.trace_type === 'llm_call'
        && next.agent_id === trace.agent_id
        && Math.abs(Date.parse(next.created_at) - at) <= 30_000
        && (!title || !traceTaskTitle(next) || titlesMatch(traceTaskTitle(next), title)));
      if (!hasCall) add({ signature: `missing_llm_call:${subject}`, summary: `${trace.agent_id} Ask Agent 뒤 llm_call이 없습니다.`, hint: 'API route, ENABLE_LIVE_LLM fallback, trace 저장 권한을 확인하세요.', role: 'reviewer' });
    }
  }
  return [...found.values()];
}

export function safeMetadataSummary(metadata: AgentTraceRow['metadata']): string {
  if (!metadata) return 'metadata —';
  return Object.entries(sanitizeTraceValue(metadata) as Record<string, unknown>).slice(0, 5)
    .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value).slice(0, 80) : String(value).slice(0, 80)}`)
    .join(' · ') || 'metadata —';
}
