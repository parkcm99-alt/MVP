'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import HighlightText from '@/components/debug/HighlightText';
import {
  detectAnomalies, eventMatchesTask, eventMatchesTrace, exportDebugBundle, importDebugBundle,
  mergeTraces, redactText, summarizeMetadata, taskMatchesTrace, traceTaskTitle, type AgentSnapshot, type DebugBundle,
} from '@/lib/debug/correlation';
import { applyOperationsLens, getLensWarnings } from '@/lib/debug/operationsLens';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { AgentTraceRow } from '@/lib/supabase/types';
import { formatKstTime } from '@/lib/time';
import { useDebugStore } from '@/store/debugStore';
import { hasActiveFilters, useOperationsStore } from '@/store/operationsStore';
import { useSimStore } from '@/store/simulationStore';
import type { AgentRole } from '@/types';

type TraceLoadState = 'idle' | 'loading' | 'ready' | 'error' | 'unavailable';
const TRACE_LIMIT = 100;

function badge(type: string): string {
  return type === 'llm_call' ? 'trace-badge--llm' : type === 'handoff' ? 'trace-badge--handoff'
    : type === 'decision' ? 'trace-badge--decision' : type === 'tool_use' ? 'trace-badge--tool' : 'trace-badge--unknown';
}
function shortSession(id: string): string { return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id; }
function metric(value: number | null, suffix = '') { return typeof value === 'number' ? `${value}${suffix}` : '—'; }
function timestamp(value: string) { const result = new Date(value).getTime(); return Number.isFinite(result) ? result : 0; }

export default function AgentTraceViewer({ refreshKey = null }: { refreshKey?: number | null }) {
  const [collapsed, setCollapsed] = useState(false);
  const [status, setStatus] = useState<TraceLoadState>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [findingMessage, setFindingMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const remote = useDebugStore(state => state.remoteTraces);
  const local = useDebugStore(state => state.localTraces);
  const liveInvocations = useDebugStore(state => state.invocations);
  const selected = useDebugStore(state => state.selectedSessionId);
  const imported = useDebugStore(state => state.importedBundle);
  const signatures = useDebugStore(state => state.findingSignatures);
  const setRemote = useDebugStore(state => state.setRemoteTraces);
  const select = useDebugStore(state => state.selectSession);
  const setImported = useDebugStore(state => state.setImportedBundle);
  const markFinding = useDebugStore(state => state.markFinding);
  const liveTasks = useSimStore(state => state.tasks);
  const liveEvents = useSimStore(state => state.events);
  const liveAgents = useSimStore(state => state.agents);
  const filters = useOperationsStore(state => state.filters);
  const clear = useOperationsStore(state => state.clearFilters);
  const setFilter = useOperationsStore(state => state.setFilter);

  const allTraces = imported ? imported.traces : mergeTraces(remote, local);
  const tasks = imported ? imported.tasks : liveTasks;
  const events = imported ? imported.events : liveEvents;
  const invocations = imported ? imported.invocations : liveInvocations;
  const result = applyOperationsLens(filters, tasks, events, allTraces);
  const traces = result.traces;
  const active = hasActiveFilters(filters);
  const lensWarnings = active ? getLensWarnings(filters, result) : [];

  const load = useCallback(async () => {
    if (useDebugStore.getState().importedBundle) return;
    const supabase = getSupabaseClient();
    if (!supabase) { setRemote([]); setStatus('unavailable'); setMessage('Supabase unavailable · local traces remain available.'); return; }
    setStatus('loading'); setMessage(null);
    try {
      const { data, error } = await supabase.from('agent_traces')
        .select('id,session_id,agent_id,trace_type,input_tokens,output_tokens,latency_ms,model,metadata,created_at')
        .order('created_at', { ascending: false }).limit(TRACE_LIMIT);
      if (error) { console.warn('[Supabase] agent_traces query failed:', error.message); setStatus('error'); setMessage('Trace query failed · local traces remain available.'); return; }
      setRemote((data ?? []) as AgentTraceRow[]); setLoadedAt(Date.now()); setStatus('ready');
    } catch { setStatus('error'); setMessage('Trace query failed safely · local traces remain available.'); }
  }, [setRemote]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load, refreshKey]);

  const invocationSessions = invocations.filter(item =>
    (!filters.sessionId.trim() || item.sessionId.toLowerCase().includes(filters.sessionId.trim().toLowerCase()))
    && (filters.role === 'all' || item.agentId === filters.role)
    && (!filters.keyword.trim() || `${item.taskTitle} ${item.agentId}`.toLowerCase().includes(filters.keyword.trim().toLowerCase()))
  ).map(item => item.sessionId);
  const sessions = [...new Set([...traces.map(trace => trace.session_id), ...invocationSessions])]
    .map(id => ({ id, traces: traces.filter(trace => trace.session_id === id) }))
    .sort((a, b) => (timestamp(b.traces[0]?.created_at ?? '') || 0) - (timestamp(a.traces[0]?.created_at ?? '') || 0));
  const sessionTraces = selected ? allTraces.filter(trace => trace.session_id === selected) : [];
  const timeline = selected ? traces.filter(trace => trace.session_id === selected).sort((a, b) => timestamp(a.created_at) - timestamp(b.created_at)) : [];
  const anomalies = selected ? detectAnomalies(selected, allTraces, invocations) : [];
  const relatedTasks = selected ? tasks.filter(task => sessionTraces.some(trace => taskMatchesTrace(task, trace)) || task.sessionId === selected).slice(0, 10) : [];
  const relatedEvents = selected ? events.filter(event =>
    sessionTraces.some(trace => eventMatchesTrace(event, trace)) || relatedTasks.some(task => eventMatchesTask(event, task))
  ).slice(0, 12) : [];
  const roles = [...new Set(sessionTraces.flatMap(trace => [trace.agent_id, typeof trace.metadata?.target_agent === 'string' ? trace.metadata.target_agent : '']))].filter(Boolean);
  const agentSnapshots: AgentSnapshot[] = imported ? imported.agents.filter(agent => roles.includes(agent.id))
    : Object.values(liveAgents).filter(agent => roles.includes(agent.id)).map(agent => ({ id: agent.id, name: agent.name, status: agent.status, currentTask: agent.currentTask, completedTasks: agent.completedTasks }));
  const grouping = [...new Map(timeline.map(trace => {
    const key = `${trace.agent_id}|${trace.trace_type}|${traceTaskTitle(trace) || '—'}`;
    return [key, { key, agent: trace.agent_id, type: trace.trace_type, task: traceTaskTitle(trace) || '—', count: timeline.filter(item => `${item.agent_id}|${item.trace_type}|${traceTaskTitle(item) || '—'}` === key).length }];
  })).values()];
  const findingSignature = selected ? `${selected}|${anomalies.map(item => item.signature).sort().join('~') || 'session-review'}` : '';
  const findingExists = signatures.includes(findingSignature) || liveTasks.some(task => task.debugSignature === findingSignature);

  function createFinding() {
    if (!selected || imported || findingExists) return;
    const isQa = anomalies.some(item => item.kind === 'failed_status' || item.kind === 'missing_decision');
    const agentId: AgentRole = isQa ? 'qa' : 'reviewer';
    const title = `Debug: ${shortSession(selected)}`;
    useSimStore.getState().addLocalTask({
      title, description: `Trace correlation finding (${anomalies.length} anomaly): ${anomalies.map(item => item.summary).join(' / ').slice(0, 500) || '세션 수동 검토'}`,
      assignedTo: agentId, status: 'backlog', priority: anomalies.length ? 'high' : 'medium',
      sessionId: selected, origin: 'debug-finding', debugSignature: findingSignature,
    });
    const agent = useSimStore.getState().agents[agentId];
    useSimStore.getState().addEvent({ agentId, agentName: agent.name, agentColor: agent.primaryColor, type: 'review',
      message: `[${agent.name}] Debug finding 생성: ${shortSession(selected)} (${anomalies.length} anomaly)`, sessionId: selected,
      metadata: { task_title: title, source: 'trace-correlation' }, localOnly: true,
    });
    markFinding(findingSignature); setFindingMessage('Local-only finding task created.');
  }

  function exportSession() {
    if (!selected) return;
    const bundle: DebugBundle = { kind: 'ai-agent-office-debug-bundle', schemaVersion: 1, exportedAt: new Date().toISOString(),
      sessionId: selected, traces: sessionTraces, tasks: relatedTasks, events: relatedEvents, agents: agentSnapshots,
      invocations: invocations.filter(item => item.sessionId === selected),
    };
    const url = URL.createObjectURL(new Blob([exportDebugBundle(bundle)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `agent-debug-${selected.slice(0, 8)}.json`;
    link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    const response = importDebugBundle(await file.text());
    if ('error' in response) { setMessage(response.error); return; }
    setImported(response.bundle); setFindingMessage(null); setMessage('Sanitized bundle opened in read-only analysis mode.');
    if (inputRef.current) inputRef.current.value = '';
  }

  return <section className={`trace-viewer${collapsed ? ' trace-viewer--collapsed' : ''}`}>
    <div className="trace-viewer-header">
      <button className="trace-viewer-toggle" type="button" onClick={() => setCollapsed(value => !value)} aria-expanded={!collapsed}><span>TRACE CORRELATION DEBUGGER</span><strong>{traces.length}/{allTraces.length}</strong></button>
      <button className="trace-refresh-btn" type="button" onClick={() => void load()} disabled={status === 'loading' || Boolean(imported)}>{status === 'loading' ? '…' : 'REFRESH'}</button>
    </div>
    {!collapsed && <div className="trace-viewer-body">
      <div className="trace-viewer-meta"><span>{imported ? 'READ-ONLY ANALYSIS' : status === 'ready' ? 'Supabase + local · recent 100' : status === 'loading' ? 'Loading…' : 'Local fallback active'}</span><span>{loadedAt ? `${formatKstTime(loadedAt)} KST` : 'not loaded'}</span></div>
      <div className="trace-toolbar">
        <button type="button" className="trace-action" onClick={() => inputRef.current?.click()}>IMPORT BUNDLE</button>
        <input ref={inputRef} type="file" accept=".json,application/json" hidden onChange={event => void importFile(event.target.files?.[0])} />
        {imported && <button type="button" className="trace-action trace-action--warning" onClick={() => { setImported(null); setMessage(null); void load(); }}>EXIT ANALYSIS</button>}
        {active && <button type="button" className="trace-action" onClick={clear}>CLEAR ALL</button>}
      </div>
      {message && <div className={`trace-message trace-message--${status}`}>{message}</div>}
      {lensWarnings.length > 0 && <div className="lens-warnings"><strong>⚠ LENS WARNINGS · local-only</strong>{lensWarnings.map(warning => <p key={warning}>{warning}</p>)}</div>}
      <div className="correlation-layout">
        <div className="session-column"><div className="trace-section-heading">SESSIONS <span>{sessions.length}</span></div>
          {sessions.length === 0 && <div className="trace-empty">No sessions match this lens.{active && <button type="button" onClick={clear}>Clear all</button>}</div>}
          <div className="session-list">{sessions.map(session => {
            const agents = [...new Set(session.traces.map(trace => trace.agent_id))];
            const types = [...new Set(session.traces.map(trace => trace.trace_type))];
            const tasks = [...new Set(session.traces.map(trace => traceTaskTitle(trace)).filter(Boolean))];
            const count = detectAnomalies(session.id, allTraces, invocations).length;
            return <button type="button" key={session.id} className={`session-card${selected === session.id ? ' session-card--selected' : ''}`} onClick={() => { select(session.id); setFindingMessage(null); }}>
              <div><strong title={session.id}><HighlightText text={shortSession(session.id)} query={filters.sessionId} /></strong><span>{session.traces.length} trace{session.traces.length === 1 ? '' : 's'}</span></div>
              <small>{agents.join(' · ') || 'invocation only'}</small><small>{types.join(' · ') || 'llm_call missing'}</small>
              {tasks.length > 0 && <small className="session-task">{redactText(tasks.slice(0, 2).join(' · '))}</small>}
              {count > 0 && <em>⚠ {count} anomaly</em>}
            </button>;
          })}</div>
        </div>
        <div className="timeline-column">
          {!selected ? <div className="correlation-placeholder">Select a session to correlate traces, tasks, events and agent state.</div> : <>
            <div className="selected-session-header"><div><span>SESSION TIMELINE</span><strong title={selected}>{shortSession(selected)}</strong></div><button type="button" className="trace-action" onClick={() => setFilter('sessionId', selected)}>LENS ↗</button></div>
            <div className="session-actions"><button type="button" className="trace-action" onClick={exportSession}>EXPORT SANITIZED JSON</button><button type="button" className="trace-action trace-action--finding" onClick={createFinding} disabled={Boolean(imported) || findingExists}>{imported ? 'READ-ONLY' : findingExists ? 'FINDING CREATED' : 'CREATE DEBUG FINDING'}</button></div>
            {findingMessage && <div className="finding-message">{findingMessage}</div>}
            <div className="trace-section-heading">GROUPS · AGENT / TYPE / TASK <span>{grouping.length}</span></div>
            <div className="group-list">{grouping.slice(0, 12).map(group => <div className="group-chip" key={group.key}><span className={`trace-badge ${badge(group.type)}`}>{group.type}</span><strong>{group.agent}</strong><span title={redactText(group.task)}>{redactText(group.task)}</span><b>×{group.count}</b></div>)}</div>
            <div className="trace-section-heading">ANOMALIES <span>{anomalies.length}</span></div>
            {anomalies.length === 0 ? <div className="healthy-message">✓ No anomalies detected for this session.</div> : <div className="anomaly-list">{anomalies.map(anomaly => <div className="anomaly-card" key={anomaly.signature}><strong>⚠ {anomaly.summary}</strong><p>↳ {anomaly.hint}</p></div>)}</div>}
            <div className="trace-section-heading">TIMELINE <span>{timeline.length}/{sessionTraces.length}</span></div>
            {timeline.length === 0 ? <div className="trace-empty">No traces match this lens.{active && <button type="button" onClick={clear}>Clear all</button>}</div> : <div className="trace-list">{timeline.map(trace => <article className="trace-card" key={trace.id}>
              <div className="trace-card-top"><span className={`trace-badge ${badge(trace.trace_type)}`}>{trace.trace_type}</span><strong><HighlightText text={trace.agent_id} query={filters.keyword} /></strong><time>{formatKstTime(trace.created_at)} KST</time></div>
              <div className="trace-card-metrics"><span title={trace.model ?? undefined}>{trace.model ?? 'model —'}</span><span>{metric(trace.latency_ms, 'ms')}</span><span>in {metric(trace.input_tokens)}</span><span>out {metric(trace.output_tokens)}</span></div>
              <p><HighlightText text={summarizeMetadata(trace.metadata)} query={filters.keyword} /></p>
            </article>)}</div>}
            <div className="correlation-context"><div><div className="trace-section-heading">RELATED TASKS <span>{relatedTasks.length}</span></div>{relatedTasks.length ? relatedTasks.map(task => <p key={task.id}><strong>{redactText(task.title)}</strong> · {task.assignedTo ?? '—'} · {task.status}</p>) : <p>None correlated.</p>}</div>
              <div><div className="trace-section-heading">EVENT LOG SLICE <span>{relatedEvents.length}</span></div>{relatedEvents.length ? relatedEvents.map(event => <p key={event.id}><span>{formatKstTime(event.timestamp)}</span> {redactText(event.message)}</p>) : <p>None correlated.</p>}</div>
              <div><div className="trace-section-heading">AGENT STATE <span>{agentSnapshots.length}</span></div>{agentSnapshots.length ? agentSnapshots.map(agent => <p key={agent.id}><strong>{agent.name}</strong> · {agent.status} · {redactText(agent.currentTask ?? '—')}</p>) : <p>No active agent snapshot.</p>}</div></div>
          </>}
        </div>
      </div>
    </div>}
  </section>;
}
