'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import HighlightText from '@/components/debug/HighlightText';
import { detectTraceAnomalies } from '@/lib/debug/anomalies';
import { createDebugBundle, MAX_BUNDLE_BYTES, parseDebugBundle, type DebugBundle } from '@/lib/debug/bundle';
import { getLocalTraces, subscribeLocalTraces } from '@/lib/debug/localTraces';
import {
  buildLensWarnings,
  filterTraces,
  hasActiveFilters,
  isEventForTask,
  isTraceForTask,
  traceTaskTitle,
} from '@/lib/debug/lens';
import { redactText, sanitizeRecord } from '@/lib/debug/sanitize';
import { getSupabaseClient } from '@/lib/supabase/client';
import { simulationEngine } from '@/lib/simulation/engine';
import type { AgentTraceRow } from '@/lib/supabase/types';
import { formatKstTime } from '@/lib/time';
import { useDebugStore } from '@/store/debugStore';
import { useOperationsStore } from '@/store/operationsStore';
import { useSimStore } from '@/store/simulationStore';

type TraceLoadState = 'idle' | 'loading' | 'ready' | 'error' | 'unavailable';
interface AgentTraceViewerProps { refreshKey?: number | null }
interface SessionGroup {
  id: string;
  traces: AgentTraceRow[];
  agents: string[];
  types: string[];
  titles: string[];
}

const TRACE_LIMIT = 100;

function formatNumber(value: number | null, suffix = ''): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value}${suffix}` : '—';
}

function getTraceBadgeClass(type: string): string {
  return type === 'llm_call' ? 'trace-badge--llm'
    : type === 'handoff' ? 'trace-badge--handoff'
      : type === 'decision' ? 'trace-badge--decision'
        : type === 'tool_use' ? 'trace-badge--tool'
          : 'trace-badge--unknown';
}

function safeShort(value: unknown, max = 48): string {
  return typeof value === 'string' ? redactText(value).slice(0, max) : '';
}

function summarizeMetadata(metadata: AgentTraceRow['metadata']): string {
  const clean = sanitizeRecord(metadata);
  if (!clean) return 'metadata —';
  const parts = Object.entries(clean).map(([key, value]) => {
    if (value === '[REDACTED]') return null;
    if (typeof value === 'string') return `${key}: ${safeShort(value)}`;
    if (typeof value === 'number' || typeof value === 'boolean') return `${key}: ${String(value)}`;
    if (Array.isArray(value)) return `${key}: [${value.length}]`;
    return null;
  }).filter((value): value is string => Boolean(value)).slice(0, 4);
  return parts.join(' · ') || 'metadata redacted';
}

function mergeRecent(remote: AgentTraceRow[], local: AgentTraceRow[]): AgentTraceRow[] {
  const byId = new Map<string, AgentTraceRow>();
  [...local, ...remote].forEach(trace => byId.set(trace.id, trace));
  return [...byId.values()]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, TRACE_LIMIT);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function groupBySession(traces: AgentTraceRow[]): SessionGroup[] {
  const bySession = new Map<string, AgentTraceRow[]>();
  traces.forEach(trace => {
    const key = trace.session_id;
    bySession.set(key, [...(bySession.get(key) ?? []), trace]);
  });
  return [...bySession.entries()].map(([id, rows]) => ({
    id,
    traces: rows,
    agents: unique(rows.map(row => row.agent_id)),
    types: unique(rows.map(row => row.trace_type)),
    titles: unique(rows.map(traceTaskTitle)),
  }));
}

function shortSession(id: string): string {
  return id.length > 17 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function TraceCard({ trace, keyword }: { trace: AgentTraceRow; keyword: string }) {
  return (
    <article className="trace-card">
      <div className="trace-card-top">
        <span className={`trace-badge ${getTraceBadgeClass(trace.trace_type)}`}>{trace.trace_type}</span>
        <strong><HighlightText text={trace.agent_id} query={keyword} /></strong>
        <time>{formatKstTime(trace.created_at)} KST</time>
      </div>
      <div className="trace-card-metrics">
        <span title={trace.model ?? undefined}><HighlightText text={trace.model ?? 'model —'} query={keyword} /></span>
        <span>{formatNumber(trace.latency_ms, 'ms')}</span>
        <span>in {formatNumber(trace.input_tokens)}</span>
        <span>out {formatNumber(trace.output_tokens)}</span>
      </div>
      <p><HighlightText text={summarizeMetadata(trace.metadata)} query={keyword} /></p>
    </article>
  );
}

export default function AgentTraceViewer({ refreshKey = null }: AgentTraceViewerProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [status, setStatus] = useState<TraceLoadState>('idle');
  const [remoteTraces, setRemoteTraces] = useState<AgentTraceRow[]>([]);
  const [localRevision, setLocalRevision] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const [imported, setImported] = useState<DebugBundle | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [findingKeys, setFindingKeys] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const filters = useOperationsStore(state => state.filters);
  const clearFilters = useOperationsStore(state => state.clearFilters);
  const selectedLiveSession = useOperationsStore(state => state.selectedSessionId);
  const selectSession = useOperationsStore(state => state.selectSession);
  const setSharedTraces = useOperationsStore(state => state.setTraces);
  const revision = useOperationsStore(state => state.revision);
  const setReadOnlyAnalysis = useOperationsStore(state => state.setReadOnlyAnalysis);
  const liveTasks = useSimStore(state => state.tasks);
  const liveEvents = useSimStore(state => state.events);
  const liveAgents = useSimStore(state => state.agents);
  const liveCalls = useDebugStore(state => state.calls);

  const loadTraces = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setRemoteTraces([]);
      setStatus('unavailable');
      setMessage('Supabase unavailable. Local trace correlation remains available.');
      setLastLoadedAt(Date.now());
      return;
    }
    setStatus('loading');
    setMessage(null);
    const { data, error } = await supabase
      .from('agent_traces')
      .select('id,session_id,agent_id,trace_type,input_tokens,output_tokens,latency_ms,model,metadata,created_at')
      .order('created_at', { ascending: false })
      .limit(TRACE_LIMIT);
    if (error) {
      console.warn('[Supabase] agent_traces query failed');
      setRemoteTraces([]);
      setStatus('error');
      setMessage('Trace query failed. Local traces are still shown.');
      setLastLoadedAt(Date.now());
      return;
    }
    setRemoteTraces((data ?? []) as AgentTraceRow[]);
    setStatus('ready');
    setLastLoadedAt(Date.now());
  }, []);

  useEffect(() => subscribeLocalTraces(() => setLocalRevision(value => value + 1)), []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void loadTraces(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadTraces, refreshKey, revision]);

  // localRevision is the subscription signal for the module's bounded buffer.
  const liveTraces = useMemo(() => {
    void localRevision;
    return mergeRecent(remoteTraces, getLocalTraces());
  }, [remoteTraces, localRevision]);
  useEffect(() => { setSharedTraces(liveTraces); }, [liveTraces, setSharedTraces]);

  const activeTraces = imported?.traces ?? liveTraces;
  const activeTasks = imported?.tasks ?? liveTasks;
  const activeEvents = imported?.events ?? liveEvents;
  const activeCalls = imported?.calls ?? liveCalls;
  const activeAgents = imported?.agents ?? Object.values(liveAgents).map(agent => ({
    id: agent.id, status: agent.status, currentTask: agent.currentTask,
  }));
  const visibleTraces = filterTraces(activeTraces, activeTasks, filters);
  const groups = groupBySession(visibleTraces);
  const selectedSessionId = imported?.sessionId ?? selectedLiveSession;

  // New/reset/filter contexts never leave the live selection pointing at stale rows.
  useEffect(() => {
    if (imported) return;
    const next = groups.some(group => group.id === selectedLiveSession)
      ? selectedLiveSession
      : groups[0]?.id ?? null;
    const titles = next ? unique(liveTraces.filter(trace => trace.session_id === next).map(traceTaskTitle)) : [];
    selectSession(next, titles);
  // groups is derived from the complete filter state and the bounded trace source.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imported, selectedLiveSession, liveTraces, filters, selectSession]);

  const sessionTraces = selectedSessionId
    ? activeTraces.filter(trace => trace.session_id === selectedSessionId)
    : [];
  const timeline = selectedSessionId
    ? visibleTraces.filter(trace => trace.session_id === selectedSessionId)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    : [];
  const sessionCalls = selectedSessionId
    ? activeCalls.filter(call => call.sessionId === selectedSessionId)
    : [];
  const relatedTasks = selectedSessionId ? activeTasks.filter(task =>
    task.sessionId === selectedSessionId || sessionTraces.some(trace => isTraceForTask(trace, task, true)),
  ) : [];
  const relatedEvents = selectedSessionId ? activeEvents.filter(event =>
    event.sessionId === selectedSessionId || relatedTasks.some(task => isEventForTask(event, task, true)),
  ).slice(0, 8) : [];
  const anomalies = detectTraceAnomalies(sessionTraces, sessionCalls);
  const warnings = buildLensWarnings(activeTasks, activeEvents, activeTraces, filters);
  const anomalySignature = anomalies.map(anomaly => anomaly.signature).sort().join('|');
  const findingKey = selectedSessionId && anomalySignature ? `${selectedSessionId}:${anomalySignature}` : '';
  const findingExists = Boolean(findingKey && (
    findingKeys.includes(findingKey)
    || liveTasks.some(task => task.source === 'debug-finding' && task.metadata?.findingKey === findingKey)
  ));

  function chooseSession(group: SessionGroup) {
    if (!imported) selectSession(group.id, unique(
      liveTraces.filter(trace => trace.session_id === group.id).map(traceTaskTitle),
    ));
  }

  function createFinding() {
    if (imported || !selectedSessionId || !findingKey || findingExists) return;
    const role: 'reviewer' | 'qa' = anomalies.some(anomaly =>
      anomaly.code === 'failure_status' || anomaly.code === 'high_latency') ? 'qa' : 'reviewer';
    const store = useSimStore.getState();
    const task = store.addTask({
      title: `[${role.toUpperCase()}] Debug finding`,
      description: anomalies.map(anomaly => anomaly.summary).slice(0, 3).join(' '),
      assignedTo: role,
      status: 'backlog',
      priority: 'high',
      sessionId: selectedSessionId,
      source: 'debug-finding',
      localOnly: true,
      metadata: { findingKey, anomalySignature, anomalyCodes: anomalies.map(anomaly => anomaly.code) },
    });
    const agent = store.agents[role];
    store.addEvent({
      agentId: role,
      agentName: agent.name,
      agentColor: agent.primaryColor,
      type: 'review',
      message: `[${agent.name}] Local debug finding 생성: ${shortSession(selectedSessionId)} (${anomalies.length} anomalies)`,
      sessionId: selectedSessionId,
      metadata: { task_title: task.title, local_only: true },
      localOnly: true,
    });
    setFindingKeys(keys => [...keys, findingKey]);
  }

  function exportSession() {
    if (!selectedSessionId) return;
    const bundle = createDebugBundle({
      sessionId: selectedSessionId,
      traces: sessionTraces.slice(0, 100),
      calls: sessionCalls.slice(0, 100),
      tasks: relatedTasks.slice(0, 100),
      events: relatedEvents.slice(0, 200),
      agents: activeAgents.slice(0, 10),
    });
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `trace-session-${shortSession(selectedSessionId).replace('…', '-')}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_BUNDLE_BYTES) {
      setImportError('Bundle is too large (maximum 1 MB).');
      return;
    }
    try {
      const result = parseDebugBundle(await file.text());
      if (!result.bundle) {
        setImportError(result.error ?? 'Could not open bundle.');
        return;
      }
      setImported(result.bundle);
      simulationEngine.stop();
      setReadOnlyAnalysis(true);
      setImportError(null);
    } catch {
      setImportError('Could not read the selected bundle.');
    }
  }

  return (
    <section className={`trace-viewer${collapsed ? ' trace-viewer--collapsed' : ''}`}>
      <div className="trace-viewer-header">
        <button className="trace-viewer-toggle" type="button" onClick={() => setCollapsed(value => !value)} aria-expanded={!collapsed}>
          <span>TRACE CORRELATION DEBUGGER</span>
          <strong>{visibleTraces.length}/{activeTraces.length}</strong>
        </button>
        <button className="trace-refresh-btn" type="button" onClick={() => { void loadTraces(); }} disabled={status === 'loading' || Boolean(imported)}>
          {status === 'loading' && !imported ? 'LOADING' : 'REFRESH'}
        </button>
      </div>

      {!collapsed && (
        <div className="trace-viewer-body">
          <div className="trace-viewer-meta">
            <span>{imported ? 'READ-ONLY IMPORT' : status === 'ready' ? 'Supabase + local · latest 100' : 'Local trace fallback'}</span>
            <span>{lastLoadedAt && !imported ? `${formatKstTime(lastLoadedAt)} KST` : imported ? 'no writes' : 'not loaded'}</span>
          </div>
          <div className="trace-toolbar">
            <button type="button" className="trace-refresh-btn" onClick={() => fileInput.current?.click()}>IMPORT BUNDLE</button>
            <button type="button" className="trace-refresh-btn" onClick={exportSession} disabled={!selectedSessionId}>EXPORT SANITIZED JSON</button>
            {imported && <button type="button" className="trace-refresh-btn" onClick={() => { setImported(null); setImportError(null); setReadOnlyAnalysis(false); }}>EXIT IMPORT</button>}
            <button type="button" className="panel-clear-btn" onClick={clearFilters} disabled={!hasActiveFilters(filters)}>CLEAR ALL</button>
            <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={event => {
              void importFile(event.target.files?.[0]);
              event.target.value = '';
            }} />
          </div>
          {message && !imported && <div className={`trace-message trace-message--${status}`}>{message}</div>}
          {importError && <div className="trace-message trace-message--error">{importError}</div>}
          {imported && <div className="trace-message trace-message--unavailable">Sanitized bundle analysis is read-only. Tasks, events, and traces will not be written.</div>}

          {warnings.length > 0 && (
            <div className="lens-warnings"><strong>LENS WARNINGS · LOCAL ONLY</strong>{warnings.map(warning => <p key={warning}>⚠ {warning}</p>)}</div>
          )}

          {groups.length === 0 ? (
            <div className="trace-empty">{activeTraces.length ? 'No traces match Operations Lens.' : 'No traces yet. Ask an agent to create local correlation context.'}</div>
          ) : (
            <div className="trace-sessions" aria-label="Trace sessions">
              {groups.map(group => (
                <button
                  key={group.id}
                  type="button"
                  className={`trace-session${selectedSessionId === group.id ? ' trace-session--selected' : ''}`}
                  onClick={() => chooseSession(group)}
                >
                  <strong><HighlightText text={shortSession(group.id)} query={filters.sessionId || filters.keyword} /></strong>
                  <span>{group.traces.length} traces</span>
                  <small>{group.agents.join(', ')} · {group.types.join(', ')}</small>
                  <small><HighlightText text={group.titles.slice(0, 2).join(' · ') || 'no task metadata'} query={filters.keyword} /></small>
                </button>
              ))}
            </div>
          )}

          {selectedSessionId && (
            <div className="trace-correlation">
              <div className="trace-section-title"><strong>SESSION TIMELINE · {shortSession(selectedSessionId)}</strong><span>{timeline.length}/{sessionTraces.length}</span></div>
              <div className="trace-group-summary">
                {unique(sessionTraces.map(trace => trace.agent_id)).map(agent => <span key={`agent-${agent}`}>{agent}: {sessionTraces.filter(trace => trace.agent_id === agent).length}</span>)}
                {unique(sessionTraces.map(trace => trace.trace_type)).map(type => <span className={`trace-badge ${getTraceBadgeClass(type)}`} key={`type-${type}`}>{type}: {sessionTraces.filter(trace => trace.trace_type === type).length}</span>)}
                {unique(sessionTraces.map(traceTaskTitle)).slice(0, 4).map(title => <span key={`task-${title}`} title={title}>task: {safeShort(title, 28)}</span>)}
              </div>
              {timeline.length ? <div className="trace-list trace-timeline">{timeline.map(trace => <TraceCard key={trace.id} trace={trace} keyword={filters.keyword} />)}</div>
                : <div className="trace-empty">No timeline entries match the current Lens.</div>}

              <div className="trace-section-title"><strong>ANOMALIES</strong><span>{anomalies.length}</span></div>
              {anomalies.length ? <div className="anomaly-list">{anomalies.map(anomaly => (
                <div className="anomaly-card" key={anomaly.signature}><strong>⚠ {anomaly.summary}</strong><p>Hint: {anomaly.hint}</p></div>
              ))}</div> : <div className="trace-empty">No automatic anomalies detected.</div>}
              <button type="button" className="finding-btn" onClick={createFinding} disabled={Boolean(imported) || !anomalies.length || findingExists}>
                {imported ? 'READ-ONLY ANALYSIS' : findingExists ? 'DEBUG FINDING CREATED' : 'CREATE DEBUG FINDING · LOCAL ONLY'}
              </button>

              <div className="trace-section-title"><strong>CORRELATED CONTEXT</strong><span>{relatedTasks.length} tasks · {relatedEvents.length} events</span></div>
              <div className="correlation-grid">
                <div><b>TASK QUEUE</b>{relatedTasks.slice(0, 5).map(task => <p key={task.id}><HighlightText text={`${task.title} · ${task.status} · ${task.assignedTo ?? 'unassigned'}`} query={filters.keyword} /></p>)}{!relatedTasks.length && <p>No current task match.</p>}</div>
                <div><b>EVENT LOG</b>{relatedEvents.slice(0, 5).map(event => <p key={event.id}><HighlightText text={event.message} query={filters.keyword} /></p>)}{!relatedEvents.length && <p>No event context.</p>}</div>
                <div><b>AGENT STATE</b>{activeAgents.map(agent => <p key={agent.id}>{agent.id} · {agent.status}{agent.currentTask ? ` · ${safeShort(agent.currentTask, 28)}` : ''}</p>)}</div>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
