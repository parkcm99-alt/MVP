'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { AgentTraceRow } from '@/lib/supabase/types';
import { formatKstTime } from '@/lib/time';
import { useSimStore } from '@/store/simulationStore';
import { useDebugStore } from '@/store/debugStore';
import type { AgentRole } from '@/types';
import { lensText, useOperationsLens } from '@/store/operationsLensStore';

type LoadState = 'idle' | 'loading' | 'ready' | 'error' | 'unavailable';
type Bundle = { schemaVersion: 1; exportedAt: string; sessionId: string; traces: AgentTraceRow[] };
type Anomaly = { signature: string; summary: string; hint: string; role: 'reviewer' | 'qa' };
interface Props { refreshKey?: number | null }
const LIMIT = 100;
const SECRET = /api.?key|authorization|bearer|credential|password|secret|service.?role|token/i;

function badge(type: string) { return `trace-badge trace-badge--${type === 'llm_call' ? 'llm' : type === 'handoff' ? 'handoff' : type === 'decision' ? 'decision' : type === 'tool_use' ? 'tool' : 'unknown'}`; }
function text(v: unknown) { return typeof v === 'string' ? v : ''; }
function taskTitle(t: AgentTraceRow) { return text(t.metadata?.task_title ?? t.metadata?.taskTitle); }
function redact(value: unknown, key = ''): unknown {
  if (SECRET.test(key)) return '[REDACTED]';
  if (typeof value === 'string' && (SECRET.test(value) || /sk-ant-|Bearer\s+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./i.test(value))) return '[REDACTED]';
  if (Array.isArray(value)) return value.map(v => redact(v));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]));
  return value;
}
function anomaliesFor(traces: AgentTraceRow[], traceRecorded: boolean | null, sessionId: string): Anomaly[] {
  const out: Anomaly[] = [];
  if (traceRecorded === false) out.push({ signature: 'trace-not-recorded', summary: '최근 Agent 호출의 traceRecorded가 false입니다.', hint: 'service role key, RLS, agent_traces insert 로그를 확인하세요.', role: 'reviewer' });
  for (const t of traces) {
    if ((t.latency_ms ?? 0) >= 10000) out.push({ signature: `slow:${t.id}`, summary: `${t.agent_id} 호출이 10초 이상 지연되었습니다.`, hint: 'provider timeout, 네트워크, token 상한을 확인하세요.', role: 'qa' });
    const status = text(t.metadata?.finalStatus ?? t.metadata?.final_status ?? t.metadata?.approvalStatus ?? t.metadata?.approval_status);
    if (/failed|changes_requested|needs_more/i.test(status)) out.push({ signature: `status:${t.id}:${status}`, summary: `${t.agent_id} 결과가 ${status}입니다.`, hint: '관련 task와 권장 수정사항을 우선 재검증하세요.', role: 'qa' });
  }
  const handoffs = traces.filter(t => t.trace_type === 'handoff' && t.agent_id === 'planner');
  for (const h of handoffs) {
    const target = text(h.metadata?.target_agent);
    const title = taskTitle(h);
    const found = traces.some(t => t.trace_type === 'decision' && (!target || t.agent_id === target) && (!title || taskTitle(t) === title));
    if (!found) out.push({ signature: `handoff:${h.id}`, summary: `Planner handoff 뒤 ${target || 'target'} decision이 없습니다.`, hint: '대상 agent의 task 시작 workflow와 decision insert를 확인하세요.', role: 'reviewer' });
  }
  if (typeof window !== 'undefined') {
    try {
      const markers = JSON.parse(localStorage.getItem('agent-ask-markers') ?? '[]') as Array<Record<string, unknown>>;
      for (const marker of markers.filter(m => m.sessionId === sessionId && m.traceRecorded === false)) {
        const role = text(marker.role);
        const hasCall = traces.some(t => t.trace_type === 'llm_call' && t.agent_id === role);
        if (!hasCall) out.push({ signature: `ask:${text(marker.id)}`, summary: `Ask ${role} 뒤 llm_call trace가 없습니다.`, hint: 'live gate, API 응답 traceRecorded, Supabase insert/RLS를 확인하세요.', role: 'reviewer' });
      }
    } catch { /* malformed local diagnostics are ignored */ }
  }
  return out;
}
function mockTraces(events: ReturnType<typeof useSimStore.getState>['events']): AgentTraceRow[] {
  return events.slice(0, LIMIT).map((e, i) => ({ id: `local-${e.id}`, session_id: 'local-session', agent_id: e.agentId, trace_type: e.type === 'planning' ? 'handoff' : e.type === 'task' ? 'decision' : 'tool_use', input_tokens: null, output_tokens: null, latency_ms: null, model: 'local', metadata: { event: e.message, task_title: e.message.split(':').slice(1).join(':').trim() }, created_at: new Date(e.timestamp + i).toISOString() }));
}

export default function AgentTraceViewer({ refreshKey = null }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [status, setStatus] = useState<LoadState>('idle');
  const [traces, setTraces] = useState<AgentTraceRow[]>([]);
  const [selected, setSelected] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [imported, setImported] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const tasks = useSimStore(s => s.tasks); const events = useSimStore(s => s.events); const agents = useSimStore(s => s.agents);
  const addLocalTask = useSimStore(s => s.addLocalTask); const addEvent = useSimStore(s => s.addEvent);
  const traceRecorded = useDebugStore(s => s.planner.traceRecorded); const setHighlight = useDebugStore(s => s.setHighlightedTaskId);
  const lens = useOperationsLens(s => s.filters);
  const load = useCallback(async () => {
    const sb = getSupabaseClient(); setMessage(null);
    if (!sb) { const local = mockTraces(useSimStore.getState().events); setTraces(local); setSelected(local[0]?.session_id ?? 'local-session'); setStatus('unavailable'); return; }
    setStatus('loading'); const { data, error } = await sb.from('agent_traces').select('id,session_id,agent_id,trace_type,input_tokens,output_tokens,latency_ms,model,metadata,created_at').order('created_at', { ascending: false }).limit(LIMIT);
    if (error) { console.warn('[Supabase] trace query failed:', error.message); setStatus('error'); setMessage('Trace query failed; local data remains available.'); return; }
    const rows = (data ?? []) as AgentTraceRow[]; setTraces(rows); setSelected(s => s || rows[0]?.session_id || ''); setStatus('ready'); setImported(false);
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load, refreshKey]);
  const sessions = useMemo(() => [...new Set(traces.map(t => t.session_id))], [traces]);
  const visible = useMemo(() => traces.filter(t => t.session_id === selected && (!lens.role || t.agent_id === lens.role) && (!lens.traceType || t.trace_type === lens.traceType) && (!lens.sessionId || t.session_id.includes(lens.sessionId)) && lensText(`${taskTitle(t)} ${JSON.stringify(t.metadata ?? {})}`, lens.keyword)), [traces, selected, lens]);
  const anomalies = useMemo(() => anomaliesFor(visible, traceRecorded, selected), [visible, traceRecorded, selected]);
  const titles = useMemo(() => new Set(visible.map(taskTitle).filter(Boolean)), [visible]);
  const relatedTasks = tasks.filter(t => [...titles].some(x => t.title.includes(x) || x.includes(t.title)));
  const relatedTaskId = relatedTasks[0]?.id ?? null;
  useEffect(() => { setHighlight(relatedTaskId); return () => setHighlight(null); }, [relatedTaskId, setHighlight]);
  function finding(a: Anomaly) {
    if (imported) return; const key = `trace-finding:${selected}:${a.signature}`; if (localStorage.getItem(key)) { setMessage('동일 anomaly finding이 이미 있습니다.'); return; }
    addLocalTask({ title: `Trace finding: ${a.summary}`.slice(0, 42), description: `${a.summary} 해결 힌트: ${a.hint} [local-only]`, assignedTo: a.role, status: 'backlog', priority: 'high' });
    addEvent({ agentId: a.role, agentName: agents[a.role].name, agentColor: agents[a.role].primaryColor, type: 'review', message: `[Trace Debugger] ${a.summary}` });
    localStorage.setItem(key, '1'); setMessage('Local-only debug finding을 생성했습니다.');
  }
  function exportBundle() { const bundle = redact({ schemaVersion: 1, exportedAt: new Date().toISOString(), sessionId: selected, traces: visible }) as Bundle; const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `trace-${selected || 'session'}.sanitized.json`; a.click(); URL.revokeObjectURL(a.href); }
  async function importBundle(file?: File) { if (!file) return; try { const raw: unknown = JSON.parse(await file.text()); if (!raw || typeof raw !== 'object' || (raw as Bundle).schemaVersion !== 1 || !Array.isArray((raw as Bundle).traces)) throw new Error('unsupported'); const b = redact(raw) as Bundle; setTraces(b.traces); setSelected(b.sessionId); setImported(true); setStatus('ready'); setMessage('Read-only sanitized bundle analysis mode.'); } catch { setMessage('손상되었거나 지원하지 않는 bundle입니다.'); } }
  return <section className={`trace-viewer${collapsed ? ' trace-viewer--collapsed' : ''}`}><div className="trace-viewer-header"><button className="trace-viewer-toggle" onClick={() => setCollapsed(v => !v)}><span>TRACE CORRELATION DEBUGGER</span><strong>{traces.length}/{LIMIT}</strong></button><button className="trace-refresh-btn" onClick={() => void load()}>REFRESH</button></div>{!collapsed && <div className="trace-viewer-body"><div className="trace-viewer-meta"><select value={selected} onChange={e => setSelected(e.target.value)}>{sessions.map(s => <option key={s}>{s}</option>)}</select><span>{imported ? 'READ-ONLY IMPORT' : status}</span></div><div style={{display:'flex',gap:4}}><button className="trace-refresh-btn" onClick={exportBundle}>EXPORT</button><button className="trace-refresh-btn" onClick={() => inputRef.current?.click()}>IMPORT</button><input ref={inputRef} hidden type="file" accept="application/json" onChange={e => void importBundle(e.target.files?.[0])}/></div>{message && <div className="trace-message">{message}</div>}<div className="trace-message">Tasks {relatedTasks.length} · Events {events.filter(e => [...titles].some(t => e.message.includes(t))).slice(0,5).length} · Agents {[...new Set(visible.map(t => t.agent_id))].map(id => `${id}:${agents[id as AgentRole]?.status ?? 'unknown'}`).join(' ') || '—'}</div>{anomalies.map(a => <div className="trace-message trace-message--error" key={a.signature}><b>{a.summary}</b><br/>{a.hint}{!imported && <button className="trace-refresh-btn" onClick={() => finding(a)}>Create Debug Finding</button>}</div>)}<div className="trace-list">{visible.map(t => <article className="trace-card" key={t.id}><div className="trace-card-top"><span className={badge(t.trace_type)}>{t.trace_type}</span><strong>{t.agent_id}</strong><time>{formatKstTime(t.created_at)} KST</time></div><div className="trace-card-metrics"><span>{t.model ?? '—'}</span><span>{t.latency_ms ?? '—'}ms</span><span>in {t.input_tokens ?? '—'}</span><span>out {t.output_tokens ?? '—'}</span></div><p>{taskTitle(t) || text(t.metadata?.event) || 'metadata —'}</p></article>)}</div></div>}</section>;
}
