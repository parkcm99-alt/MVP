'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { getSessionId } from '@/lib/supabase/session';
import type { AgentTraceRow } from '@/lib/supabase/types';
import { formatKstTime } from '@/lib/time';
import { useSimStore } from '@/store/simulationStore';
import { useDebugStore } from '@/store/debugStore';
import { includesKeyword, useLensStore } from '@/store/lensStore';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';
type Anomaly = { signature: string; summary: string; hint: string; role: 'reviewer' | 'qa' };
type Bundle = { schemaVersion: 1; exportedAt: string; sessionId: string; traces: AgentTraceRow[] };
const TRACE_LIMIT = 100;
const MAX_IMPORT_BYTES = 2_000_000;
const SECRET_KEY = /api.?key|authorization|bearer|credential|password|secret|service.?role|token/i;
const SECRET_VALUE = /(?:sk-(?:ant-|proj-)?[a-z0-9_-]{12,}|gh[pousr]_[a-z0-9_]{12,}|github_pat_[a-z0-9_]{12,}|sb_(?:secret|publishable)_[a-z0-9_-]{12,}|bearer\s+\S+|eyJ[a-zA-Z0-9_-]{10,}\.)/i;
const TRACE_TYPES = new Set(['llm_call', 'handoff', 'decision', 'tool_use']);

function badge(type: string) {
  return type === 'llm_call' ? 'trace-badge--llm' : type === 'handoff' ? 'trace-badge--handoff' : type === 'decision' ? 'trace-badge--decision' : type === 'tool_use' ? 'trace-badge--tool' : 'trace-badge--unknown';
}
function taskTitle(t: AgentTraceRow): string {
  const m = t.metadata ?? {};
  const value = m.task_title ?? m.taskTitle;
  return typeof value === 'string' ? value : '';
}
function sanitize(value: unknown, key = ''): unknown {
  if (SECRET_KEY.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return SECRET_VALUE.test(value) ? '[REDACTED]' : value.slice(0, 2000);
  if (Array.isArray(value)) return value.map(v => sanitize(v));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v, k)]));
  return value;
}
function metadataText(metadata: AgentTraceRow['metadata']) {
  if (!metadata) return 'metadata —';
  return Object.entries(sanitize(metadata) as Record<string, unknown>).slice(0, 4).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v).slice(0, 60) : String(v)}`).join(' · ');
}
function validImportedTrace(value: unknown, sessionId: string): value is AgentTraceRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const trace = value as Partial<AgentTraceRow>;
  return typeof trace.id === 'string'
    && trace.id.length <= 200
    && trace.session_id === sessionId
    && typeof trace.agent_id === 'string'
    && trace.agent_id.length <= 80
    && typeof trace.trace_type === 'string'
    && TRACE_TYPES.has(trace.trace_type)
    && typeof trace.created_at === 'string'
    && Number.isFinite(Date.parse(trace.created_at))
    && (trace.metadata === null || (typeof trace.metadata === 'object' && !Array.isArray(trace.metadata)));
}
function anomaliesFor(traces: AgentTraceRow[]): Anomaly[] {
  const sorted = [...traces].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const out: Anomaly[] = [];
  for (const [i, t] of sorted.entries()) {
    const m = t.metadata ?? {};
    if (m.traceRecorded === false || m.traceRecorded === 'false') out.push({ signature: `trace-false:${t.id}`, summary: `${t.agent_id} trace가 기록되지 않았습니다.`, hint: 'Supabase 설정과 service role 권한을 확인하세요.', role: 'reviewer' });
    if ((t.latency_ms ?? 0) >= 10000) out.push({ signature: `latency:${t.id}`, summary: `${t.agent_id} 호출 지연이 10초 이상입니다.`, hint: 'timeout, 모델 가용성, 네트워크 상태를 확인하세요.', role: 'qa' });
    const status = String(m.finalStatus ?? m.final_status ?? m.approvalStatus ?? m.approval_status ?? '').toLowerCase();
    if (['failed', 'changes_requested', 'needs_more_info', 'needs_more_testing'].includes(status)) out.push({ signature: `status:${t.id}:${status}`, summary: `${t.agent_id} 결과가 ${status} 상태입니다.`, hint: '권장 변경 또는 실패 테스트를 후속 task로 추적하세요.', role: 'reviewer' });
    const target = String(m.target_agent ?? '');
    if (t.trace_type === 'handoff' && !sorted.slice(i + 1).some(n => n.trace_type === 'decision'
      && (!target || n.agent_id === target)
      && (!taskTitle(t) || taskTitle(n) === taskTitle(t)))) out.push({ signature: `handoff:${t.id}`, summary: `${t.agent_id} handoff 뒤 decision이 없습니다.`, hint: '대상 agent의 task 시작과 decision trace 기록을 확인하세요.', role: 'qa' });
    const action = String(m.action ?? m.event ?? '').toLowerCase();
    if ((m.askAgent === true || action.includes('ask_agent')) && !sorted.slice(i + 1).some(n => n.trace_type === 'llm_call' && n.agent_id === t.agent_id)) out.push({ signature: `ask:${t.id}`, summary: `${t.agent_id} Ask Agent 뒤 llm_call이 없습니다.`, hint: 'API route 응답과 ENABLE_LIVE_LLM fallback 상태를 확인하세요.', role: 'reviewer' });
  }
  return out;
}
function localTraces(): AgentTraceRow[] {
  const now = new Date().toISOString();
  return Object.values(useSimStore.getState().agents).filter(a => a.currentTask).map((a, i) => ({ id: `local-${a.id}-${i}`, session_id: getSessionId(), agent_id: a.id, trace_type: 'decision', input_tokens: null, output_tokens: null, latency_ms: null, model: 'local', metadata: { task_title: a.currentTask, status: a.status, source: 'local' }, created_at: now }));
}

export default function AgentTraceViewer({ refreshKey = null }: { refreshKey?: number | null }) {
  const [collapsed, setCollapsed] = useState(false);
  const [status, setStatus] = useState<LoadState>('idle');
  const [traces, setTraces] = useState<AgentTraceRow[]>([]);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const tasks = useSimStore(s => s.tasks);
  const events = useSimStore(s => s.events);
  const agents = useSimStore(s => s.agents);
  const addLocalTask = useSimStore(s => s.addLocalTask);
  const addEvent = useSimStore(s => s.addEvent);
  const setHighlight = useDebugStore(s => s.setHighlightedTaskTitle);
  const recentAgentCalls = useDebugStore(s => s.recentAgentCalls);
  const lens = useLensStore(s => s.filters);

  const load = useCallback(async () => {
    setStatus('loading'); setError(null); setReadOnly(false);
    const supabase = getSupabaseClient();
    if (!supabase) { const local = localTraces(); setTraces(local); setSelected(local[0]?.session_id ?? getSessionId()); setStatus('ready'); return; }
    const { data, error: queryError } = await supabase.from('agent_traces').select('id,session_id,agent_id,trace_type,input_tokens,output_tokens,latency_ms,model,metadata,created_at').order('created_at', { ascending: false }).limit(TRACE_LIMIT);
    if (queryError) { console.warn('[Supabase] agent_traces query failed:', queryError.message); const local = localTraces(); setTraces(local); setSelected(local[0]?.session_id ?? getSessionId()); setError('Trace query failed; local analysis mode.'); setStatus('error'); return; }
    const rows = (data ?? []) as AgentTraceRow[]; setTraces(rows); setSelected(s => s && rows.some(t => t.session_id === s) ? s : rows[0]?.session_id ?? ''); setStatus('ready');
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load, refreshKey]);

  const sessions = useMemo(() => [...new Set(traces.map(t => t.session_id))], [traces]);
  const sessionTraces = useMemo(() => traces.filter(t => t.session_id === selected), [traces, selected]);
  const active = useMemo(() => sessionTraces.filter(t =>
    (!lens.sessionId || t.session_id.includes(lens.sessionId)) &&
    (!lens.role || t.agent_id === lens.role) &&
    (!lens.traceType || t.trace_type === lens.traceType) &&
    includesKeyword(`${taskTitle(t)} ${JSON.stringify(t.metadata ?? {})}`, lens.keyword)
  ), [sessionTraces, lens]);
  const anomalies = useMemo(() => {
    const traceAnomalies = anomaliesFor(sessionTraces);
    if (readOnly) return traceAnomalies;
    const callAnomalies = recentAgentCalls
      .filter(call => call.sessionId === selected && !call.traceRecorded)
      .map(call => ({
        signature: `ask-call:${call.id}`,
        summary: `${call.role} Ask Agent 호출 뒤 llm_call이 확인되지 않았습니다.`,
        hint: 'API 응답의 traceRecorded, live-LLM 설정, Supabase trace 권한을 확인하세요.',
        role: 'reviewer' as const,
      }));
    return [...traceAnomalies, ...callAnomalies];
  }, [sessionTraces, recentAgentCalls, selected, readOnly]);
  const groups = useMemo(() => {
    const grouped = new Map<string, AgentTraceRow[]>();
    for (const trace of active) {
      const key = `${trace.session_id} / ${trace.agent_id} / ${trace.trace_type} / ${taskTitle(trace) || '—'}`;
      grouped.set(key, [...(grouped.get(key) ?? []), trace]);
    }
    return [...grouped.entries()];
  }, [active]);
  const titles = useMemo(() => [...new Set(active.map(taskTitle).filter(Boolean))], [active]);
  const relatedTasks = tasks.filter(t => titles.some(x => t.title.toLowerCase().includes(x.toLowerCase()) || x.toLowerCase().includes(t.title.toLowerCase())));
  const relatedEvents = events.filter(e => titles.some(x => e.message.toLowerCase().includes(x.toLowerCase())) || active.some(t => e.agentId === t.agent_id)).slice(0, 8);
  const lensWarnings = [
    ...(relatedTasks.length > 0 && relatedEvents.length === 0 ? ['Matching task has no related event.'] : []),
    ...(relatedTasks.length > 0 && active.length === 0 ? ['Matching task has no related trace.'] : []),
    ...(lens.sessionId && selected && !selected.includes(lens.sessionId) ? ['SessionId mismatch.'] : []),
  ];
  useEffect(() => { setHighlight(titles.find(x => tasks.some(t => t.title.toLowerCase().includes(x.toLowerCase()))) ?? null); return () => setHighlight(null); }, [titles, tasks, setHighlight]);

  function createFinding() {
    if (readOnly) return;
    const a = anomalies.find(item => !localStorage.getItem(`trace-finding:${selected}:${item.signature}`));
    if (!a) { setError('동일한 session/anomaly finding이 이미 있습니다.'); return; }
    const key = `trace-finding:${selected}:${a.signature}`;
    addLocalTask({ title: `Trace finding: ${a.summary}`.slice(0, 40), description: `${a.summary} ${a.hint} [local-only]`, assignedTo: a.role, status: 'backlog', priority: 'high' });
    addEvent({ agentId: a.role, agentName: a.role === 'qa' ? 'QA' : 'Reviewer', agentColor: '#F59E0B', type: 'review', message: `[Trace Debug] ${a.summary}` });
    localStorage.setItem(key, '1');
  }
  function exportBundle() {
    const bundle = sanitize({ schemaVersion: 1, exportedAt: new Date().toISOString(), sessionId: selected, traces: sessionTraces }) as Bundle;
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = `trace-${selected || 'session'}.sanitized.json`; a.click(); URL.revokeObjectURL(url);
  }
  async function importBundle(file?: File) {
    if (!file) return;
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error('too_large');
      const parsed = JSON.parse(await file.text()) as Partial<Bundle>;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.traces) || parsed.traces.length > TRACE_LIMIT || typeof parsed.sessionId !== 'string' || !parsed.sessionId) throw new Error('unsupported');
      const safe = sanitize(parsed.traces) as AgentTraceRow[];
      if (!safe.every(t => validImportedTrace(t, parsed.sessionId!))) throw new Error('invalid');
      setTraces(safe); setSelected(parsed.sessionId); setReadOnly(true); setStatus('ready'); setError(null);
    } catch { setError('손상된 JSON 또는 지원하지 않는 schema version입니다.'); }
    finally { if (inputRef.current) inputRef.current.value = ''; }
  }

  return <section className={`trace-viewer${collapsed ? ' trace-viewer--collapsed' : ''}`}>
    <div className="trace-viewer-header"><button className="trace-viewer-toggle" type="button" onClick={() => setCollapsed(v => !v)}><span>TRACE CORRELATION DEBUGGER</span><strong>{traces.length}/{TRACE_LIMIT}</strong></button><button className="trace-refresh-btn" onClick={() => void load()} disabled={status === 'loading'}>REFRESH</button></div>
    {!collapsed && <div className="trace-viewer-body">
      <div className="trace-viewer-meta"><span>{readOnly ? 'READ-ONLY IMPORT' : status}</span><span>{active.length}/{traces.filter(t => t.session_id === selected).length} filtered · {sessions.length} sessions · {anomalies.length} anomalies</span></div>
      {error && <div className="trace-message trace-message--error">{error}</div>}
      <select value={selected} onChange={e => setSelected(e.target.value)} style={{ width: '100%', background: '#07111f', color: '#cbd5e1', fontSize: 10 }}><option value="">Select session</option>{sessions.map(s => <option key={s} value={s}>{s}</option>)}</select>
      <div style={{ display: 'flex', gap: 4, margin: '5px 0' }}><button className="trace-refresh-btn" onClick={createFinding} disabled={readOnly || !anomalies.length}>CREATE DEBUG FINDING</button><button className="trace-refresh-btn" onClick={exportBundle} disabled={!sessionTraces.length}>EXPORT</button><button className="trace-refresh-btn" onClick={() => inputRef.current?.click()}>IMPORT</button><input ref={inputRef} hidden type="file" accept="application/json" onChange={e => void importBundle(e.target.files?.[0])} /></div>
      {lensWarnings.map(w => <div key={w} className="trace-message trace-message--error">Lens warning: {w}</div>)}
      {anomalies.map(a => <div key={a.signature} className="trace-message trace-message--error"><strong>{a.summary}</strong><br />Hint: {a.hint}</div>)}
      {active.length === 0 && <div className="trace-empty">No traces match · use Clear all</div>}
      <div className="trace-list">{groups.map(([group, rows]) => <section key={group}><div style={{ fontSize: 9, color: '#94a3b8', margin: '5px 0' }}>{group} ({rows.length})</div>{rows.map(t => <article className="trace-card" key={t.id}><div className="trace-card-top"><span className={`trace-badge ${badge(t.trace_type)}`}>{t.trace_type}</span><strong>{t.agent_id}</strong><time>{formatKstTime(t.created_at)} KST</time></div><div className="trace-card-metrics"><span>{t.model ?? 'model —'}</span><span>{t.latency_ms ?? '—'}ms</span><span>in {t.input_tokens ?? '—'}</span><span>out {t.output_tokens ?? '—'}</span></div><p>{metadataText(t.metadata)}</p></article>)}</section>)}</div>
      <div style={{ fontSize: 9, color: '#cbd5e1', marginTop: 6 }}><strong>RELATED TASKS</strong>: {relatedTasks.map(t => t.title).join(' · ') || '—'}<br /><strong>EVENT LOG</strong>: {relatedEvents.map(e => e.message).join(' · ') || '—'}<br /><strong>AGENTS</strong>: {Object.values(agents).filter(a => active.some(t => t.agent_id === a.id)).map(a => `${a.id}:${a.status}`).join(' · ') || '—'}</div>
    </div>}
  </section>;
}
