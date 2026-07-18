'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import LensHighlight from '@/components/debug/LensHighlight';
import { useOperationsData } from '@/hooks/useOperationsData';
import { applyOperationsLens, taskMatchesEvent, taskMatchesTrace, traceTaskTitle } from '@/lib/debug/operationsLens';
import {
  createSanitizedBundle,
  detectTraceAnomalies,
  parseTraceBundle,
  sanitizeValue,
  type BundleAgent,
  type TraceDebugBundle,
} from '@/lib/debug/traceDebugger';
import { getSupabaseClient } from '@/lib/supabase/client';
import { formatKstTime } from '@/lib/time';
import type { AgentTraceRow } from '@/lib/supabase/types';
import { useDebugStore } from '@/store/debugStore';
import { useLensStore } from '@/store/lensStore';
import { useSimStore } from '@/store/simulationStore';
import type { AgentRole, SimEvent, SimTask } from '@/types';

type TraceLoadState = 'idle' | 'loading' | 'ready' | 'error' | 'unavailable';
const TRACE_LIMIT = 100;
const SENSITIVE_METADATA_KEY = /api|auth|credential|key|password|secret|token|bearer/i;

interface AgentTraceViewerProps { refreshKey?: number | null }

function badgeClass(type: string): string {
  return type === 'llm_call' ? 'trace-badge--llm'
    : type === 'handoff' ? 'trace-badge--handoff'
      : type === 'decision' ? 'trace-badge--decision'
        : type === 'tool_use' ? 'trace-badge--tool' : 'trace-badge--unknown';
}

function numberLabel(value: number | null, suffix = ''): string {
  return typeof value === 'number' ? `${value}${suffix}` : '—';
}

function metadataSummary(metadata: AgentTraceRow['metadata']): string {
  if (!metadata) return 'metadata —';
  const safe = sanitizeValue(metadata) as Record<string, unknown>;
  const parts = Object.entries(safe)
    .filter(([key]) => !SENSITIVE_METADATA_KEY.test(key))
    .map(([key, value]) => {
      if (typeof value === 'string') return `${key}: ${value.slice(0, 52)}`;
      if (typeof value === 'number' || typeof value === 'boolean') return `${key}: ${value}`;
      if (Array.isArray(value)) return `${key}: [${value.length}]`;
      return null;
    })
    .filter((value): value is string => Boolean(value))
    .slice(0, 4);
  return parts.join(' · ') || 'metadata redacted';
}

function compactId(sessionId: string): string {
  return sessionId.length > 16 ? `${sessionId.slice(0, 8)}…${sessionId.slice(-4)}` : sessionId;
}

function groupCounts(values: string[]): string {
  return [...new Set(values)].map(value => `${value} ×${values.filter(item => item === value).length}`).join(' · ');
}

function relatedContext(
  sessionId: string,
  traces: AgentTraceRow[],
  tasks: SimTask[],
  events: SimEvent[],
) {
  const relatedTasks = tasks.filter(task => traces.some(trace => taskMatchesTrace(task, trace))
    || (task.sessionId === sessionId && traces.some(trace => trace.agent_id === task.assignedTo)));
  const relatedEvents = events.filter(event => event.sessionId === sessionId
    && (traces.some(trace => trace.agent_id === event.agentId)
      || relatedTasks.some(task => taskMatchesEvent(task, event))));
  return { relatedTasks: relatedTasks.slice(0, 12), relatedEvents: relatedEvents.slice(0, 12) };
}

export default function AgentTraceViewer({ refreshKey = null }: AgentTraceViewerProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [status, setStatus] = useState<TraceLoadState>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const [imported, setImported] = useState<TraceDebugBundle | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { filters, tasks, events, traces: liveTraces, filtered: liveFiltered } = useOperationsData();
  const clearLens = useLensStore(state => state.clear);
  const calls = useDebugStore(state => state.calls);
  const setRemoteTraces = useDebugStore(state => state.setRemoteTraces);
  const selectedSessionId = useDebugStore(state => state.selectedSessionId);
  const setSelectedSessionId = useDebugStore(state => state.setSelectedSessionId);
  const findingSignatures = useDebugStore(state => state.findingSignatures);
  const rememberFinding = useDebugStore(state => state.rememberFinding);
  const agents = useSimStore(state => state.agents);

  const loadTraces = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setStatus('unavailable');
      setMessage('Supabase unavailable · local traces remain usable.');
      setRemoteTraces([]);
      return;
    }
    setStatus('loading');
    setMessage(null);
    try {
      const { data, error } = await supabase
        .from('agent_traces')
        .select('id,session_id,agent_id,trace_type,input_tokens,output_tokens,latency_ms,model,metadata,created_at')
        .order('created_at', { ascending: false })
        .limit(TRACE_LIMIT);
      if (error) {
        console.warn('[Supabase] agent_traces query failed:', error.code ?? 'query_error');
        setStatus('error');
        setMessage('Trace query failed · local traces remain usable.');
        setRemoteTraces([]);
        return;
      }
      setRemoteTraces((data ?? []) as AgentTraceRow[]);
      setLastLoadedAt(Date.now());
      setStatus('ready');
    } catch {
      console.warn('[Supabase] agent_traces query failed: network_error');
      setStatus('error');
      setMessage('Trace query failed · local traces remain usable.');
      setRemoteTraces([]);
    }
  }, [setRemoteTraces]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadTraces(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadTraces, refreshKey]);

  const importedFiltered = useMemo(() => imported
    ? applyOperationsLens(filters, imported.tasks, imported.events, imported.traces)
    : null, [filters, imported]);
  const sourceTraces = imported ? imported.traces : liveTraces;
  const visibleTraces = importedFiltered?.traces ?? liveFiltered.traces;
  const sourceTasks = importedFiltered?.tasks ?? liveFiltered.tasks;
  const sourceEvents = importedFiltered?.events ?? liveFiltered.events;
  const sessionGroups = useMemo(() => {
    const groups = new Map<string, AgentTraceRow[]>();
    visibleTraces.forEach(trace => groups.set(trace.session_id, [...(groups.get(trace.session_id) ?? []), trace]));
    return [...groups.entries()];
  }, [visibleTraces]);
  const activeSessionId = imported?.sessionId ?? selectedSessionId;
  const sessionTraces = visibleTraces
    .filter(trace => trace.session_id === activeSessionId)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const fullSessionTraces = sourceTraces
    .filter(trace => trace.session_id === activeSessionId)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const sessionCalls = (imported?.calls ?? calls).filter(call => call.sessionId === activeSessionId);
  // Filters narrow the display, not the diagnostic evidence behind anomaly detection/export.
  const anomalies = activeSessionId ? detectTraceAnomalies(activeSessionId, fullSessionTraces, sessionCalls) : [];
  const context = activeSessionId
    ? relatedContext(activeSessionId, sessionTraces, sourceTasks, sourceEvents)
    : { relatedTasks: [], relatedEvents: [] };
  const fullContext = activeSessionId
    ? relatedContext(activeSessionId, fullSessionTraces, imported?.tasks ?? tasks, imported?.events ?? events)
    : { relatedTasks: [], relatedEvents: [] };
  const activeRoles = [...new Set(fullSessionTraces.map(trace => trace.agent_id))];
  const agentContext: BundleAgent[] = imported
    ? imported.agents.filter(agent => activeRoles.includes(agent.id))
    : activeRoles
      .filter((role): role is AgentRole => role in agents)
      .map(role => ({ id: role, status: agents[role].status, currentTask: agents[role].currentTask }));
  const findingSignature = activeSessionId && anomalies.length
    ? `${activeSessionId}|${anomalies.map(anomaly => anomaly.signature).sort().join('|')}`
    : null;
  const findingExists = Boolean(findingSignature && findingSignatures.includes(findingSignature));

  function createFinding() {
    if (imported || !activeSessionId || !findingSignature || findingExists) return;
    const role: 'reviewer' | 'qa' = anomalies.some(anomaly => /qa|final|test/i.test(anomaly.summary)) ? 'qa' : 'reviewer';
    const title = `Debug finding ${compactId(activeSessionId)}`;
    useSimStore.getState().addLocalTask({
      title,
      description: `[local-debug-finding] ${anomalies.map(anomaly => anomaly.summary).slice(0, 3).join(' | ')}`,
      assignedTo: role,
      status: 'backlog',
      priority: anomalies.some(anomaly => anomaly.severity === 'error') ? 'high' : 'medium',
      sessionId: activeSessionId,
      origin: 'debug-finding',
    });
    const agent = useSimStore.getState().agents[role];
    useSimStore.getState().addEvent({
      agentId: role,
      agentName: agent.name,
      agentColor: agent.primaryColor,
      type: 'review',
      message: `[${agent.name}] Local debug finding 생성: ${compactId(activeSessionId)}`,
      sessionId: activeSessionId,
      metadata: { taskTitle: title, localOnly: true },
      localOnly: true,
    });
    rememberFinding(findingSignature);
  }

  function exportBundle() {
    if (!activeSessionId) return;
    const bundle = createSanitizedBundle({
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      sessionId: activeSessionId,
      traces: fullSessionTraces,
      calls: sessionCalls,
      tasks: fullContext.relatedTasks,
      events: fullContext.relatedEvents,
      agents: agentContext,
    });
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `trace-session-${compactId(activeSessionId).replace('…', '-')}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importBundle(file?: File) {
    if (!file) return;
    setImportError(null);
    try {
      const parsed = parseTraceBundle(await file.text());
      if (!parsed.bundle) {
        setImportError(parsed.error ?? 'Bundle could not be imported.');
        return;
      }
      setImported(parsed.bundle);
      setSelectedSessionId(null);
    } catch {
      setImportError('Bundle could not be read safely.');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  return (
    <section className={`trace-viewer${collapsed ? ' trace-viewer--collapsed' : ''}`}>
      <div className="trace-viewer-header">
        <button className="trace-viewer-toggle" type="button" onClick={() => setCollapsed(value => !value)} aria-expanded={!collapsed}>
          <span>TRACE CORRELATION</span><strong>{visibleTraces.length}/{sourceTraces.length}</strong>
        </button>
        <button className="trace-refresh-btn" type="button" onClick={() => void loadTraces()} disabled={status === 'loading' || Boolean(imported)}>
          {status === 'loading' ? '...' : 'REFRESH'}
        </button>
      </div>
      {!collapsed && (
        <div className="trace-viewer-body correlation-body">
          <div className="trace-viewer-meta">
            <span>{imported ? 'READ-ONLY BUNDLE' : status === 'ready' ? 'latest 100 + local' : status}</span>
            <span>{lastLoadedAt && !imported ? `${formatKstTime(lastLoadedAt)} KST` : 'safe analysis'}</span>
          </div>
          <div className="correlation-actions">
            <button className="trace-control-btn" type="button" onClick={clearLens}>Clear all</button>
            <button className="trace-control-btn" type="button" onClick={() => fileInput.current?.click()}>Import bundle</button>
            {imported && <button className="trace-control-btn" type="button" onClick={() => { setImported(null); setImportError(null); }}>Exit read-only</button>}
            <input ref={fileInput} className="visually-hidden" type="file" accept="application/json,.json" onChange={event => { void importBundle(event.target.files?.[0]); }} />
          </div>
          {message && !imported && <div className={`trace-message trace-message--${status}`}>{message}</div>}
          {importError && <div className="trace-message trace-message--error">{importError}</div>}
          {visibleTraces.length === 0 && (
            <div className="trace-empty">No matching traces. Use an Ask Agent button or <button type="button" onClick={clearLens}>Clear all</button>.</div>
          )}

          {sessionGroups.length > 0 && (
            <div className="correlation-section">
              <div className="correlation-label">SESSIONS · grouped by agent / type / task</div>
              <div className="session-list">
                {sessionGroups.map(([sessionId, rows]) => (
                  <button
                    className={`session-card${activeSessionId === sessionId ? ' session-card--active' : ''}`}
                    type="button"
                    key={sessionId}
                    onClick={() => { if (!imported) setSelectedSessionId(sessionId); }}
                  >
                    <strong><LensHighlight text={compactId(sessionId)} query={filters.sessionId} /></strong>
                    <span>{rows.length} traces · {groupCounts(rows.map(row => row.agent_id))}</span>
                    <span>{groupCounts(rows.map(row => row.trace_type))}</span>
                    <span>{[...new Set(rows.map(traceTaskTitle).filter(Boolean))].slice(0, 2).join(' · ') || 'no task title'}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeSessionId && fullSessionTraces.length > 0 && (
            <>
              <div className="correlation-section">
                <div className="correlation-section-heading"><span>ANOMALIES · {anomalies.length}</span>
                  {!imported && anomalies.length > 0 && <button className="trace-control-btn" type="button" disabled={findingExists} onClick={createFinding}>{findingExists ? 'Finding created' : 'Create Debug Finding'}</button>}
                </div>
                {anomalies.length === 0 ? <div className="trace-empty">No anomalies detected in this session.</div> : (
                  <div className="anomaly-list">{anomalies.map(anomaly => <div className={`anomaly-card anomaly-card--${anomaly.severity}`} key={anomaly.signature}><strong>{anomaly.summary}</strong><span>Hint: {anomaly.hint}</span></div>)}</div>
                )}
                {imported && <div className="read-only-note">Imported bundles are read-only. No Supabase or simulation writes are allowed.</div>}
              </div>

              <div className="correlation-section">
                <div className="correlation-section-heading"><span>SESSION TIMELINE</span><button className="trace-control-btn" type="button" onClick={exportBundle}>Export sanitized JSON</button></div>
                <div className="trace-list correlation-timeline">
                  {sessionTraces.length === 0 && <div className="trace-empty">No timeline rows match the current Lens.</div>}
                  {sessionTraces.map(trace => (
                    <article className="trace-card" key={trace.id}>
                      <div className="trace-card-top">
                        <span className={`trace-badge ${badgeClass(trace.trace_type)}`}>{trace.trace_type}</span>
                        <strong><LensHighlight text={trace.agent_id} query={filters.keyword} /></strong>
                        <time>{formatKstTime(trace.created_at)} KST</time>
                      </div>
                      <div className="trace-card-metrics"><span>{trace.model ?? 'model —'}</span><span>{numberLabel(trace.latency_ms, 'ms')}</span><span>in {numberLabel(trace.input_tokens)}</span><span>out {numberLabel(trace.output_tokens)}</span></div>
                      <p><LensHighlight text={metadataSummary(trace.metadata)} query={filters.keyword} /></p>
                    </article>
                  ))}
                </div>
              </div>

              <div className="correlation-section">
                <div className="correlation-label">CORRELATED CONTEXT</div>
                <div className="context-block"><strong>Tasks {context.relatedTasks.length}</strong>{context.relatedTasks.length
                  ? context.relatedTasks.map(task => <span key={task.id}><LensHighlight text={`${task.title} · ${task.assignedTo ?? 'unassigned'} · ${task.status}`} query={filters.keyword} /></span>)
                  : <span>No matching Task Queue item.</span>}</div>
                <div className="context-block"><strong>Events {context.relatedEvents.length}</strong>{context.relatedEvents.length
                  ? context.relatedEvents.slice(0, 5).map(event => <span key={event.id}><LensHighlight text={event.message} query={filters.keyword} /></span>)
                  : <span>No matching Event Log fragment.</span>}</div>
                <div className="context-block"><strong>Agent state</strong>{agentContext.length
                  ? agentContext.map(agent => <span key={agent.id}>{agent.id} · {agent.status}{agent.currentTask ? ` · ${agent.currentTask.slice(0, 40)}` : ''}</span>)
                  : <span>No agent snapshot.</span>}</div>
              </div>

            </>
          )}
          {!activeSessionId && sessionGroups.length > 0 && <div className="trace-empty">Select a session to correlate its timeline, tasks, events, and agent state.</div>}
        </div>
      )}
    </section>
  );
}
