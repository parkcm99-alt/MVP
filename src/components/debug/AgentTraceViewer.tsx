'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import HighlightedText from '@/components/debug/HighlightedText';
import { detectAnomalies, mergeTraces } from '@/lib/debug/correlation';
import {
  buildLensWarnings, filterEvents, filterTasks, filterTraces, getTraceTaskTitle,
  relatedEventTrace, relatedTaskEvent, relatedTaskTrace,
} from '@/lib/debug/lens';
import { parseTraceBundle, safeMetadataText, sanitizeValue } from '@/lib/debug/sanitize';
import type { TraceBundle, TraceInvocation } from '@/lib/debug/types';
import { getSupabaseClient } from '@/lib/supabase/client';
import { getSessionId } from '@/lib/supabase/session';
import type { AgentTraceRow } from '@/lib/supabase/types';
import { formatKstTime } from '@/lib/time';
import { useLensStore } from '@/store/lensStore';
import { useSimStore } from '@/store/simulationStore';
import { useTraceStore } from '@/store/traceStore';
import type { AgentRole } from '@/types';

type TraceLoadState = 'idle' | 'loading' | 'ready' | 'error' | 'unavailable';
const TRACE_LIMIT = 100;

function badgeClass(type: string): string {
  return type === 'llm_call' ? 'trace-badge--llm' : type === 'handoff' ? 'trace-badge--handoff'
    : type === 'decision' ? 'trace-badge--decision' : type === 'tool_use' ? 'trace-badge--tool' : 'trace-badge--unknown';
}
function number(value: number | null, suffix = ''): string { return typeof value === 'number' ? `${value}${suffix}` : '—'; }
function shortSession(value: string): string { return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value; }
function countBy(values: string[]): string {
  const counts = new Map<string, number>();
  values.filter(Boolean).forEach(value => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts].map(([value, count]) => `${value} ${count}`).join(' · ') || '—';
}
function invocationMatches(invocation: TraceInvocation, role: string, session: string, keyword: string): boolean {
  return (!role || invocation.agentId === role)
    && (!session || invocation.sessionId.toLowerCase().includes(session.trim().toLowerCase()))
    && (!keyword || `${invocation.agentId} ${invocation.taskTitle}`.toLowerCase().includes(keyword.trim().toLowerCase()));
}

export default function AgentTraceViewer({ refreshKey = null }: { refreshKey?: number | null }) {
  const [collapsed, setCollapsed] = useState(false);
  const [status, setStatus] = useState<TraceLoadState>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const [bundleError, setBundleError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const remote = useTraceStore(s => s.remoteTraces);
  const local = useTraceStore(s => s.localTraces);
  const liveInvocations = useTraceStore(s => s.invocations);
  const selectedSessionId = useTraceStore(s => s.selectedSessionId);
  const imported = useTraceStore(s => s.importedBundle);
  const findings = useTraceStore(s => s.findingSignatures);
  const setRemote = useTraceStore(s => s.setRemoteTraces);
  const selectSession = useTraceStore(s => s.selectSession);
  const setImported = useTraceStore(s => s.setImportedBundle);
  const markFinding = useTraceStore(s => s.markFinding);
  const liveTasks = useSimStore(s => s.tasks);
  const liveEvents = useSimStore(s => s.events);
  const liveAgents = useSimStore(s => s.agents);
  const filters = useLensStore(s => s.filters);
  const clearFilters = useLensStore(s => s.clear);

  const loadTraces = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) { setStatus('unavailable'); setMessage('Supabase unavailable · local traces remain usable.'); return; }
    setStatus('loading'); setMessage(null);
    const { data, error } = await supabase.from('agent_traces')
      .select('id,session_id,agent_id,trace_type,input_tokens,output_tokens,latency_ms,model,metadata,created_at')
      .order('created_at', { ascending: false }).limit(TRACE_LIMIT);
    if (error) {
      console.warn('[Supabase] agent_traces query failed:', error.message);
      setStatus('error'); setMessage('Trace query failed · local traces remain usable.'); return;
    }
    setRemote((data ?? []) as AgentTraceRow[]);
    setLastLoadedAt(Date.now()); setStatus('ready');
  }, [setRemote]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadTraces(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadTraces, refreshKey]);

  const allTraces = imported?.traces ?? mergeTraces(remote, local);
  const sourceTasks = imported?.tasks ?? liveTasks;
  const sourceEvents = imported?.events ?? liveEvents;
  const sourceAgents = imported?.agents ?? Object.values(liveAgents);
  const invocations = imported?.invocations ?? liveInvocations;
  const currentSession = imported?.sessionId ?? getSessionId();
  const filtered = filterTraces(allTraces, sourceTasks, filters);
  const filteredTasks = filterTasks(sourceTasks, allTraces, filters, currentSession);
  const filteredEvents = filterEvents(sourceEvents.slice(0, 200), sourceTasks, allTraces, filters, currentSession);
  const lensWarnings = buildLensWarnings(filteredTasks, filteredEvents, filtered, filters, currentSession);

  const sessionIds = [...new Set([
    ...filtered.map(trace => trace.session_id),
    ...invocations.filter(call => invocationMatches(call, filters.role, filters.sessionId, filters.keyword)).map(call => call.sessionId),
  ])];
  const selected = selectedSessionId && sessionIds.includes(selectedSessionId) ? selectedSessionId : null;
  const sessionTraces = selected ? allTraces.filter(trace => trace.session_id === selected) : [];
  const timeline = selected ? filtered.filter(trace => trace.session_id === selected).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)) : [];
  const sessionCalls = selected ? invocations.filter(call => call.sessionId === selected) : [];
  const anomalies = detectAnomalies(sessionTraces, sessionCalls);
  const relatedTasks = selected ? sourceTasks.filter(task => sessionTraces.some(trace => relatedTaskTrace(task, trace))
    || sessionCalls.some(call => call.taskTitle.toLowerCase() === task.title.toLowerCase())) : [];
  const relatedEvents = selected ? sourceEvents.filter(event => relatedTasks.some(task => relatedTaskEvent(task, event))
    || sessionTraces.some(trace => relatedEventTrace(event, trace))) : [];
  const involvedRoles = new Set<string>(sessionTraces.flatMap(trace => [
    trace.agent_id,
    typeof trace.metadata?.target_agent === 'string' ? trace.metadata.target_agent : '',
    typeof trace.metadata?.source_agent === 'string' ? trace.metadata.source_agent : '',
  ]).concat(sessionCalls.map(call => call.agentId)));
  const relatedAgents = sourceAgents.filter(agent => involvedRoles.has(agent.id));
  const findingSignature = selected ? `${selected}:${anomalies.map(item => item.signature).sort().join('|') || 'manual'}` : '';
  const alreadyCreated = findings.includes(findingSignature);

  function createFinding() {
    if (!selected || imported || alreadyCreated) return;
    const role: AgentRole = anomalies.some(item => item.code === 'slow_call' || item.code === 'failed_outcome') ? 'qa' : 'reviewer';
    const title = `Debug finding · ${shortSession(selected)}`;
    const detail = anomalies.length ? anomalies.map(item => item.summary).join(' | ') : 'Manual correlation review requested.';
    const store = useSimStore.getState();
    store.addLocalTask({ title, description: `[debug-finding] ${detail.slice(0, 700)}`, assignedTo: role, status: 'backlog', priority: anomalies.length ? 'high' : 'medium', sessionId: selected });
    const agent = store.agents[role];
    store.addEvent({ agentId: role, agentName: agent.name, agentColor: agent.primaryColor, type: 'review', message: `[${agent.name}] Local debug finding 생성: ${shortSession(selected)}`, sessionId: selected, localOnly: true });
    markFinding(findingSignature);
  }

  function exportBundle() {
    if (!selected) return;
    const bundle: TraceBundle = {
      schemaVersion: 1, exportedAt: new Date().toISOString(), sessionId: selected,
      traces: sessionTraces.slice(0, 100), tasks: relatedTasks.slice(0, 200), events: relatedEvents.slice(0, 200),
      agents: relatedAgents, invocations: sessionCalls.slice(0, 100),
    };
    const safe = sanitizeValue(bundle);
    const url = URL.createObjectURL(new Blob([JSON.stringify(safe, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `trace-bundle-${selected.slice(0, 8)}.json`;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Let the browser finish resolving the download attribute before cleanup.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    setBundleError(null);
    try {
      const result = parseTraceBundle(await file.text());
      if ('error' in result) { setBundleError(result.error); return; }
      clearFilters();
      setImported(result.bundle);
    } catch { setBundleError('Could not read bundle safely.'); }
    finally { if (fileRef.current) fileRef.current.value = ''; }
  }

  return <section className={`trace-viewer${collapsed ? ' trace-viewer--collapsed' : ''}`}>
    <div className="trace-viewer-header">
      <button className="trace-viewer-toggle" type="button" onClick={() => setCollapsed(value => !value)} aria-expanded={!collapsed}>
        <span>TRACE CORRELATION DEBUGGER</span><strong>{filtered.length}/{allTraces.length}</strong>
      </button>
      <button className="trace-refresh-btn" type="button" onClick={() => void loadTraces()} disabled={status === 'loading' || Boolean(imported)}>{status === 'loading' ? '...' : 'REFRESH'}</button>
    </div>
    {!collapsed && <div className="trace-viewer-body">
      <div className="trace-viewer-meta"><span>{imported ? 'READ-ONLY IMPORT' : status === 'ready' ? 'Supabase + local' : status === 'loading' ? 'Loading...' : 'Local fallback'}</span><span>{lastLoadedAt ? `${formatKstTime(lastLoadedAt)} KST` : 'not loaded'}</span></div>
      {message && !imported && <div className={`trace-message trace-message--${status}`}>{message}</div>}
      {imported && <div className="trace-import-banner">Read-only analysis · no Supabase writes <button type="button" onClick={() => { setImported(null); setBundleError(null); }}>EXIT</button></div>}
      <div className="trace-tools">
        <button type="button" className="trace-tool-btn" onClick={() => fileRef.current?.click()}>IMPORT BUNDLE</button>
        <button type="button" className="trace-tool-btn" onClick={exportBundle} disabled={!selected}>EXPORT SANITIZED JSON</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={event => void importFile(event.target.files?.[0])} />
      </div>
      {bundleError && <div className="trace-message trace-message--error">{bundleError}</div>}
      {lensWarnings.length > 0 && <div className="lens-warnings"><strong>LENS WARNINGS · local only</strong>{lensWarnings.map(warning => <p key={warning}>{warning}</p>)}</div>}

      <div className="trace-section-title">SESSIONS · {sessionIds.length}</div>
      {sessionIds.length === 0 && <div className="trace-empty">No matching traces or sessions. <button type="button" onClick={clearFilters}>Clear all</button></div>}
      <div className="trace-session-list">
        {sessionIds.map(sessionId => {
          const rows = filtered.filter(trace => trace.session_id === sessionId);
          const taskTitles = [...new Set(rows.map(getTraceTaskTitle).filter(Boolean))];
          return <button type="button" className={`trace-session-card${selected === sessionId ? ' trace-session-card--active' : ''}`} key={sessionId} onClick={() => selectSession(sessionId)}>
            <div><strong><HighlightedText text={shortSession(sessionId)} query={filters.keyword || filters.sessionId} /></strong><span>{rows.length} traces</span></div>
            <small>{countBy(rows.map(trace => trace.agent_id))}</small>
            <small>{countBy(rows.map(trace => trace.trace_type))}</small>
            <small title={taskTitles.join(' · ')}>{taskTitles.slice(0, 2).join(' · ') || 'No task title'}</small>
          </button>;
        })}
      </div>

      {selected && <>
        <div className="trace-selected-header"><strong>SESSION {shortSession(selected)}</strong><span>{timeline.length}/{sessionTraces.length} traces</span></div>
        <div className="trace-timeline">
          {timeline.length === 0 && <div className="trace-empty">No timeline rows match. <button type="button" onClick={clearFilters}>Clear all</button></div>}
          {timeline.map(trace => <article className="trace-card" key={trace.id}>
            <div className="trace-card-top"><span className={`trace-badge ${badgeClass(trace.trace_type)}`}>{trace.trace_type}</span><strong>{trace.agent_id}</strong><time>{formatKstTime(trace.created_at)} KST</time></div>
            <div className="trace-card-metrics"><span title={trace.model ?? undefined}>{trace.model ?? 'model —'}</span><span>{number(trace.latency_ms, 'ms')}</span><span>in {number(trace.input_tokens)}</span><span>out {number(trace.output_tokens)}</span></div>
            <p><HighlightedText text={safeMetadataText(trace.metadata)} query={filters.keyword} /></p>
          </article>)}
        </div>
        <div className="trace-section-title">ANOMALIES · {anomalies.length}</div>
        {anomalies.length === 0 ? <div className="trace-ok">No anomaly detected for this session.</div> : <div className="anomaly-list">{anomalies.map(item => <div className="anomaly-card" key={item.signature}><strong>⚠ {item.summary}</strong><span>Hint: {item.hint}</span></div>)}</div>}
        <div className="trace-context-grid">
          <div><strong>TASKS · {relatedTasks.length}</strong>{relatedTasks.slice(0, 6).map(task => <p key={task.id}>{task.title} · {task.assignedTo ?? '—'} · {task.status}</p>)}{relatedTasks.length === 0 && <p>None correlated.</p>}</div>
          <div><strong>AGENTS · {relatedAgents.length}</strong>{relatedAgents.map(agent => <p key={agent.id}>{agent.id} · {agent.status}</p>)}{relatedAgents.length === 0 && <p>No state snapshot.</p>}</div>
        </div>
        <div className="trace-context-events"><strong>EVENT LOG · {relatedEvents.length}</strong>{relatedEvents.slice(0, 5).map(event => <p key={event.id}>{formatKstTime(event.timestamp)} · {event.message}</p>)}{relatedEvents.length === 0 && <p>No correlated event.</p>}</div>
        <button type="button" className="finding-btn" onClick={createFinding} disabled={Boolean(imported) || alreadyCreated}>{imported ? 'READ-ONLY ANALYSIS' : alreadyCreated ? 'FINDING ALREADY CREATED' : 'CREATE DEBUG FINDING'}</button>
      </>}
    </div>}
  </section>;
}
