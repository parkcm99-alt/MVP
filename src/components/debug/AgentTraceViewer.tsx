'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { AgentTraceRow } from '@/lib/supabase/types';
import { formatKstTime } from '@/lib/time';
import { getSessionId } from '@/lib/supabase/session';
import { useSimStore } from '@/store/simulationStore';
import { useTraceDebugStore } from '@/store/traceDebugStore';
import { textMatches, useOperationsLensStore } from '@/store/operationsLensStore';
import {
  detectTraceAnomalies,
  parseTraceBundle,
  sanitizeJson,
  TRACE_BUNDLE_VERSION,
  type TraceBundle,
} from '@/lib/debug/traceCorrelation';

type TraceLoadState = 'idle' | 'loading' | 'ready' | 'error' | 'unavailable';
interface AgentTraceViewerProps { refreshKey?: number | null }
const TRACE_LIMIT = 100;
const SENSITIVE_METADATA_KEY = /api|auth|authorization|credential|key|password|secret|token/i;

function badge(type: string) {
  return type === 'llm_call' ? 'trace-badge--llm' : type === 'handoff' ? 'trace-badge--handoff' :
    type === 'decision' ? 'trace-badge--decision' : type === 'tool_use' ? 'trace-badge--tool' : 'trace-badge--unknown';
}
function taskTitle(trace: AgentTraceRow): string | null {
  const value = trace.metadata?.task_title;
  return typeof value === 'string' ? value : null;
}
function metadataSummary(metadata: AgentTraceRow['metadata']): string {
  if (!metadata) return 'metadata —';
  const parts = Object.entries(metadata).filter(([key]) => !SENSITIVE_METADATA_KEY.test(key)).slice(0, 4)
    .map(([key, value]) => `${key}: ${typeof value === 'object' ? '…' : String(value).slice(0, 45)}`);
  return parts.length ? parts.join(' · ') : 'metadata redacted';
}
function groupedCounts(values: string[]): string {
  const counts = new Map<string, number>();
  values.forEach(value => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts].slice(0, 3).map(([value, count]) => `${value}×${count}`).join(', ');
}

export default function AgentTraceViewer({ refreshKey = null }: AgentTraceViewerProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [status, setStatus] = useState<TraceLoadState>('idle');
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [imported, setImported] = useState<TraceBundle | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const localTraces = useTraceDebugStore(s => s.localTraces);
  const remoteTraces = useTraceDebugStore(s => s.remoteTraces);
  const setRemoteTraces = useTraceDebugStore(s => s.setRemoteTraces);
  const setHighlights = useTraceDebugStore(s => s.setHighlightedTaskTitles);
  const claimFinding = useTraceDebugStore(s => s.claimFinding);
  const tasks = useSimStore(s => s.tasks);
  const events = useSimStore(s => s.events);
  const agents = useSimStore(s => s.agents);
  const addLocalTask = useSimStore(s => s.addLocalTask);
  const addEvent = useSimStore(s => s.addEvent);
  const lens = {
    agentRole: useOperationsLensStore(s => s.agentRole),
    taskStatus: useOperationsLensStore(s => s.taskStatus),
    priority: useOperationsLensStore(s => s.priority),
    traceType: useOperationsLensStore(s => s.traceType),
    sessionId: useOperationsLensStore(s => s.sessionId),
    keyword: useOperationsLensStore(s => s.keyword),
  };
  const clearLens = useOperationsLensStore(s => s.clearAll);

  const loadTraces = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) { setStatus('unavailable'); setMessage('Supabase unavailable — local trace mode is active.'); return; }
    setStatus('loading'); setMessage(null);
    const { data, error } = await supabase.from('agent_traces')
      .select('id,session_id,agent_id,trace_type,input_tokens,output_tokens,latency_ms,model,metadata,created_at')
      .order('created_at', { ascending: false }).limit(TRACE_LIMIT);
    if (error) { setStatus('error'); setMessage('Trace query failed — local trace mode remains available.'); return; }
    setRemoteTraces((data ?? []) as AgentTraceRow[]); setStatus('ready');
  }, [setRemoteTraces]);

  useEffect(() => { const timer = window.setTimeout(() => void loadTraces(), 0); return () => clearTimeout(timer); }, [loadTraces, refreshKey]);

  const allTraces = useMemo(() => {
    if (imported) return imported.traces;
    const byId = new Map<string, AgentTraceRow>();
    [...localTraces, ...remoteTraces].forEach(trace => byId.set(trace.id, trace));
    return [...byId.values()].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, TRACE_LIMIT);
  }, [imported, localTraces, remoteTraces]);
  const traces = allTraces.filter(trace => {
    const title = taskTitle(trace);
    const relatedTask = tasks.find(task => title === task.title);
    return (!lens.agentRole || trace.agent_id === lens.agentRole) &&
      (!lens.traceType || trace.trace_type === lens.traceType) &&
      (!lens.sessionId || trace.session_id.toLowerCase().includes(lens.sessionId.toLowerCase())) &&
      (!lens.taskStatus || relatedTask?.status === lens.taskStatus) &&
      (!lens.priority || relatedTask?.priority === lens.priority) &&
      textMatches(lens.keyword, trace.agent_id, trace.trace_type, trace.model, title);
  });

  const groupedSessions = new Map<string, AgentTraceRow[]>();
  for (const trace of traces) {
    groupedSessions.set(trace.session_id, [...(groupedSessions.get(trace.session_id) ?? []), trace]);
  }
  const sessions = [...groupedSessions.entries()]
    .sort((a, b) => Date.parse(b[1][0]?.created_at ?? '') - Date.parse(a[1][0]?.created_at ?? ''));

  const activeSession = sessions.some(([id]) => id === selectedSession)
    ? selectedSession
    : sessions[0]?.[0] ?? null;
  const selected = sessions.find(([id]) => id === activeSession)?.[1] ?? [];
  const anomalies = detectTraceAnomalies(selected);
  const titles = new Set(selected.map(taskTitle).filter((v): v is string => Boolean(v)));
  const relatedTasks = tasks.filter(task => titles.has(task.title));
  const relatedAgents = [...new Set(selected.map(trace => trace.agent_id))];
  const relatedEvents = events.filter(event =>
    relatedAgents.includes(event.agentId) || [...titles].some(title => event.message.includes(title)),
  ).slice(0, 8);
  const lensTasks = tasks.filter(task =>
    (!lens.agentRole || task.assignedTo === lens.agentRole) &&
    (!lens.taskStatus || task.status === lens.taskStatus) &&
    (!lens.priority || task.priority === lens.priority) &&
    textMatches(lens.keyword, task.title, task.description),
  );
  const missingEventCount = lensTasks.filter(task =>
    !events.some(event => event.message.includes(task.title) || event.agentId === task.assignedTo)).length;
  const missingTraceCount = lensTasks.filter(task =>
    !traces.some(trace => taskTitle(trace) === task.title)).length;
  const roleMismatchCount = lensTasks.filter(task => {
    const taskTraces = traces.filter(trace => taskTitle(trace) === task.title);
    return task.assignedTo && taskTraces.length > 0 && !taskTraces.some(trace => trace.agent_id === task.assignedTo);
  }).length;
  const sessionMismatch = Boolean(lens.sessionId) &&
    !(imported?.sessionId ?? getSessionId()).toLowerCase().includes(lens.sessionId.toLowerCase());
  const highlight = (value: string) => {
    const needle = lens.keyword.trim();
    const index = value.toLowerCase().indexOf(needle.toLowerCase());
    return !needle || index < 0 ? value : <>{value.slice(0, index)}<mark className="lens-mark">{value.slice(index, index + needle.length)}</mark>{value.slice(index + needle.length)}</>;
  };

  function chooseSession(id: string) {
    setSelectedSession(id);
    const sessionTitles = sessions.find(([session]) => session === id)?.[1]
      .map(taskTitle).filter((title): title is string => Boolean(title)) ?? [];
    setHighlights([...new Set(sessionTitles)]);
  }

  function createFinding(anomaly: (typeof anomalies)[number]) {
    if (imported) { setMessage('Imported bundles are read-only; no local or Supabase writes were made.'); return; }
    if (!activeSession) { setMessage('No anomaly is available for a finding.'); return; }
    const key = `${activeSession}:${anomaly.signature}`;
    if (!claimFinding(key)) { setMessage('This session/anomaly finding already exists.'); return; }
    const role = anomaly.kind === 'failure_status' ? 'qa' : 'reviewer';
    addLocalTask({ title: `Debug Finding: ${anomaly.summary}`.slice(0, 100), description: `[local-only] ${anomaly.hint} signature=${anomaly.signature}`, assignedTo: role, status: 'backlog', priority: 'high' });
    addEvent({ agentId: role, agentName: agents[role].name, agentColor: agents[role].primaryColor, type: 'review', message: `[Debug Finding] ${anomaly.summary}` });
    setMessage('Local-only debug finding created.');
  }

  function exportBundle() {
    if (!activeSession) return;
    const bundle = sanitizeJson({ schemaVersion: TRACE_BUNDLE_VERSION, exportedAt: new Date().toISOString(), sessionId: activeSession, traces: selected }) as TraceBundle;
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `agent-traces-${activeSession.slice(0, 12)}.json`; anchor.click(); URL.revokeObjectURL(url);
  }

  async function importBundle(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error('Bundle is larger than 2 MB.');
      const bundle = parseTraceBundle(await file.text());
      setImported(bundle); setSelectedSession(bundle.sessionId); setHighlights([]);
      setMessage('Sanitized bundle opened in read-only analysis mode.');
    } catch (error) {
      setMessage(error instanceof Error ? `Import rejected: ${error.message}` : 'Import rejected safely.');
    }
  }

  return (
    <section className={`trace-viewer${collapsed ? ' trace-viewer--collapsed' : ''}`}>
      <div className="trace-viewer-header">
        <button className="trace-viewer-toggle" type="button" onClick={() => setCollapsed(v => !v)}>
          <span>TRACE CORRELATION DEBUGGER</span><strong>{traces.length}/{allTraces.length}</strong>
        </button>
        {!imported && <button className="trace-refresh-btn" type="button" onClick={() => void loadTraces()} disabled={status === 'loading'}>REFRESH</button>}
      </div>
      {!collapsed && <div className="trace-viewer-body">
        <div className="trace-viewer-meta"><span>{imported ? 'READ-ONLY IMPORT' : status === 'unavailable' ? 'LOCAL MODE' : status.toUpperCase()}</span><span>{sessions.length} sessions</span></div>
        {message && <div className="trace-message">{message}</div>}
        <div className="trace-toolbar">
          <button onClick={exportBundle} disabled={!activeSession}>EXPORT JSON</button>
          <button onClick={() => inputRef.current?.click()}>IMPORT JSON</button>
          <button onClick={clearLens}>CLEAR ALL</button>
          {imported && <button onClick={() => { setImported(null); setMessage('Returned to live/local mode.'); }}>EXIT IMPORT</button>}
          <input ref={inputRef} type="file" accept="application/json,.json" hidden onChange={(e: ChangeEvent<HTMLInputElement>) => void importBundle(e.target.files?.[0])} />
        </div>
        {(missingEventCount > 0 || missingTraceCount > 0 || roleMismatchCount > 0 || sessionMismatch) &&
          <div className="lens-warnings">LENS WARNINGS · missing event {missingEventCount} · missing trace {missingTraceCount} · role mismatch {roleMismatchCount}{sessionMismatch ? ' · session mismatch' : ''}</div>}
        <div className="trace-session-list">
          {sessions.map(([id, rows]) => {
            const sessionAnomalies = detectTraceAnomalies(rows);
            const dimensions = [
              `agent ${groupedCounts(rows.map(row => row.agent_id))}`,
              `type ${groupedCounts(rows.map(row => row.trace_type))}`,
              `task ${groupedCounts(rows.map(row => taskTitle(row) ?? '—'))}`,
            ];
            return <button key={id} className={`trace-session-btn${id === activeSession ? ' active' : ''}`} onClick={() => chooseSession(id)}>
              <strong>{id.slice(0, 14)}</strong><span>{rows.length} traces · {sessionAnomalies.length} anomalies</span><small>{dimensions.join(' | ')}</small>
            </button>;
          })}
        </div>
        {activeSession && <>
          <div className="trace-context">
            <span>Tasks: {relatedTasks.map(task => task.title).join(', ') || 'none'}</span>
            <span>Events: {relatedEvents.map(event => event.message).join(' | ') || 'none'}</span>
            <span>Agents: {relatedAgents.map(id => `${id}(${agents[id as keyof typeof agents]?.status ?? 'unknown'})`).join(', ')}</span>
          </div>
          {anomalies.length > 0 && <div className="trace-anomalies">
            {anomalies.map(item => <div key={item.signature}>
              <strong>⚠ {item.summary}</strong><span>{item.hint}</span>
              <button onClick={() => createFinding(item)} disabled={Boolean(imported)}>CREATE DEBUG FINDING</button>
            </div>)}
          </div>}
          <div className="trace-list">
            {[...selected].reverse().map(trace => <article className="trace-card" key={trace.id}>
              <div className="trace-card-top"><span className={`trace-badge ${badge(trace.trace_type)}`}>{highlight(trace.trace_type)}</span><strong>{highlight(trace.agent_id)}</strong><time>{formatKstTime(trace.created_at)} KST</time></div>
              <div className="trace-card-metrics"><span>{highlight(taskTitle(trace) ?? trace.model ?? '—')}</span><span>{trace.latency_ms ?? '—'}ms</span><span>in {trace.input_tokens ?? '—'}</span><span>out {trace.output_tokens ?? '—'}</span></div>
              <p>{highlight(metadataSummary(trace.metadata))}</p>
            </article>)}
          </div>
        </>}
        {traces.length === 0 && <div className="trace-empty">No traces match the Operations Lens.</div>}
      </div>}
    </section>
  );
}
