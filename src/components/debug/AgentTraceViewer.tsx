'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import HighlightText from '@/components/debug/HighlightText';
import { useOperationsLens } from '@/hooks/useOperationsLens';
import {
  createSanitizedBundle,
  detectTraceAnomalies,
  eventMatchesTrace,
  groupTraceSessions,
  parseSanitizedBundle,
  summarizeTraceMetadata,
  taskMatchesEvent,
  taskMatchesTrace,
  TRACE_LIMIT,
  traceTaskTitle,
  type AgentSnapshot,
  type TraceSessionGroup,
} from '@/lib/debug/correlation';
import { isLensActive } from '@/lib/debug/operationsLens';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { AgentTraceRow } from '@/lib/supabase/types';
import { formatKstTime } from '@/lib/time';
import { useDebugStore } from '@/store/debugStore';
import { useSimStore } from '@/store/simulationStore';
import type { AgentRole } from '@/types';

type TraceLoadState = 'idle' | 'loading' | 'ready' | 'error' | 'unavailable';
interface AgentTraceViewerProps { refreshKey?: number | null }

function badgeClass(type: string): string {
  return type === 'llm_call' ? 'trace-badge--llm' : type === 'handoff' ? 'trace-badge--handoff'
    : type === 'decision' ? 'trace-badge--decision' : type === 'tool_use' ? 'trace-badge--tool' : 'trace-badge--unknown';
}
function num(value: number | null, suffix = ''): string { return typeof value === 'number' ? `${value}${suffix}` : '—'; }
function shortSession(value: string): string { return `${value.slice(0, 8)}…${value.slice(-4)}`; }
function statusLabel(status: TraceLoadState, localCount: number): string {
  if (status === 'loading') return 'Loading Supabase traces...';
  if (status === 'unavailable') return localCount ? 'Local/mock traces' : 'Supabase unavailable · local ready';
  if (status === 'error') return localCount ? 'Query failed · local traces' : 'Trace query failed';
  if (status === 'ready') return 'Supabase + local traces';
  return 'Local ready';
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function GroupChips({ label, items }: { label: string; items: Array<{ value: string; count: number }> }) {
  if (!items.length) return null;
  return <div className="trace-group-line"><span>{label}</span>
    <div>{items.slice(0, 6).map(item => <span className="trace-group-chip" key={item.value} title={item.value}>
      {item.value.length > 24 ? `${item.value.slice(0, 22)}…` : item.value} <b>{item.count}</b>
    </span>)}</div>
  </div>;
}

export default function AgentTraceViewer({ refreshKey = null }: AgentTraceViewerProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [status, setStatus] = useState<TraceLoadState>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const [findingRole, setFindingRole] = useState<'reviewer' | 'qa'>('reviewer');
  const fileRef = useRef<HTMLInputElement>(null);

  const { traces: filteredTraces, tasks: filteredTasks, events: filteredEvents,
    allTraces, allTasks, allEvents, warnings, filters, imported } = useOperationsLens();
  const remote = useDebugStore(state => state.remoteTraces);
  const local = useDebugStore(state => state.localTraces);
  const calls = useDebugStore(state => state.calls);
  const selectedSession = useDebugStore(state => state.selectedSessionId);
  const importedBundle = useDebugStore(state => state.importedBundle);
  const findingSignatures = useDebugStore(state => state.findingSignatures);
  const setRemoteTraces = useDebugStore(state => state.setRemoteTraces);
  const selectSession = useDebugStore(state => state.selectSession);
  const setImportedBundle = useDebugStore(state => state.setImportedBundle);
  const clearFilters = useDebugStore(state => state.clearFilters);
  const markFinding = useDebugStore(state => state.markFinding);
  const liveAgents = useSimStore(state => state.agents);
  const addTask = useSimStore(state => state.addTask);
  const addEvent = useSimStore(state => state.addEvent);
  const liveTasks = useSimStore(state => state.tasks);

  const loadTraces = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setStatus('unavailable');
      setMessage(null);
      return;
    }
    setStatus('loading');
    setMessage(null);
    const { data, error } = await supabase.from('agent_traces')
      .select('id,session_id,agent_id,trace_type,input_tokens,output_tokens,latency_ms,model,metadata,created_at')
      .order('created_at', { ascending: false }).limit(TRACE_LIMIT);
    if (error) {
      console.warn('[Supabase] agent_traces query failed: query_failed');
      setStatus('error');
      setMessage('Could not load remote traces. Local evidence is still available.');
      return;
    }
    setRemoteTraces((data ?? []) as AgentTraceRow[]);
    setLastLoadedAt(Date.now());
    setStatus('ready');
  }, [setRemoteTraces]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadTraces(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadTraces, refreshKey]);

  const activeCalls = importedBundle?.calls ?? calls;
  const groups = useMemo(() => {
    const result = groupTraceSessions(filteredTraces);
    // Failed button requests may have no trace at all, but still deserve a timeline.
    activeCalls.forEach(call => {
      if (result.some(group => group.sessionId === call.sessionId)) return;
      if ((filters.role !== 'all' && filters.role !== call.agentId)
        || (filters.traceType !== 'all' && filters.traceType !== 'llm_call')
        || (filters.sessionId && !call.sessionId.toLowerCase().includes(filters.sessionId.toLowerCase()))
        || (filters.keyword && !`${call.taskTitle} ${call.agentId}`.toLowerCase().includes(filters.keyword.toLowerCase()))
        || ((filters.taskStatus !== 'all' || filters.priority !== 'all')
          && !filteredTasks.some(task => task.sessionId === call.sessionId
            && (task.title === call.taskTitle || task.title.includes(call.taskTitle) || call.taskTitle.includes(task.title))))) return;
      result.push({ sessionId: call.sessionId, traces: [], agents: [{ value: call.agentId, count: 1 }],
        types: [], tasks: [{ value: call.taskTitle, count: 1 }], latestAt: new Date(call.calledAt).toISOString() });
    });
    return result.sort((a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime());
  }, [activeCalls, filteredTasks, filteredTraces, filters]);

  const sessionTraces = useMemo(() => selectedSession
    ? allTraces.filter(trace => trace.session_id === selectedSession) : [], [allTraces, selectedSession]);
  const timeline = useMemo(() => selectedSession
    ? filteredTraces.filter(trace => trace.session_id === selectedSession)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) : [],
  [filteredTraces, selectedSession]);
  const sessionCalls = useMemo(() => selectedSession
    ? activeCalls.filter(call => call.sessionId === selectedSession) : [], [activeCalls, selectedSession]);
  const anomalies = useMemo(() => detectTraceAnomalies(sessionTraces, sessionCalls), [sessionTraces, sessionCalls]);
  const relatedTasks = useMemo(() => selectedSession ? allTasks.filter(task => task.sessionId === selectedSession
    || sessionTraces.some(trace => taskMatchesTrace(task, trace))) : [], [allTasks, selectedSession, sessionTraces]);
  const relatedEvents = useMemo(() => selectedSession ? allEvents.filter(event => event.sessionId === selectedSession
    && (sessionTraces.some(trace => eventMatchesTrace(event, trace))
      || relatedTasks.some(task => taskMatchesEvent(task, event))
      || sessionCalls.some(call => event.agentId === call.agentId))) : [],
  [allEvents, selectedSession, sessionTraces, relatedTasks, sessionCalls]);
  const visibleRelatedTasks = useMemo(() => relatedTasks.filter(task => filteredTasks.some(item => item.id === task.id)),
    [relatedTasks, filteredTasks]);
  const visibleRelatedEvents = useMemo(() => relatedEvents.filter(event => filteredEvents.some(item => item.id === event.id)),
    [relatedEvents, filteredEvents]);
  const relatedAgents = useMemo((): AgentSnapshot[] => {
    const ids = new Set<AgentRole>([
      ...sessionTraces.map(trace => trace.agent_id as AgentRole),
      ...sessionCalls.map(call => call.agentId),
      ...relatedTasks.map(task => task.assignedTo).filter((role): role is AgentRole => role !== null),
    ]);
    if (importedBundle) return importedBundle.agents.filter(agent => ids.has(agent.id));
    return [...ids].map(id => liveAgents[id]).filter(Boolean).map(agent => ({
      id: agent.id, name: agent.name, status: agent.status,
      currentTask: agent.currentTask, completedTasks: agent.completedTasks,
    }));
  }, [sessionTraces, sessionCalls, relatedTasks, importedBundle, liveAgents]);
  const visibleRelatedAgents = useMemo(() => filters.role === 'all' ? relatedAgents
    : relatedAgents.filter(agent => agent.id === filters.role), [relatedAgents, filters.role]);
  const selectedGroup: TraceSessionGroup | undefined = groups.find(group => group.sessionId === selectedSession)
    ?? (selectedSession ? groupTraceSessions(sessionTraces)[0] : undefined);

  const findingSignature = selectedSession
    ? `finding-${stableHash(`${selectedSession}|${anomalies.map(anomaly => anomaly.signature).sort().join('|') || 'manual'}`)}` : '';
  const findingExists = Boolean(findingSignature && (findingSignatures.includes(findingSignature)
    || liveTasks.some(task => task.description.includes(`signature=${findingSignature}`))));

  function createFinding() {
    if (!selectedSession || imported || findingExists) return;
    const first = anomalies[0];
    const title = `Debug Finding: ${first?.kind ?? 'session review'}`.slice(0, 48);
    const details = anomalies.length ? anomalies.map(anomaly => anomaly.summary).join(' | ') : '선택한 session timeline을 수동 검토합니다.';
    addTask({
      title,
      description: `[debug-finding][local-only] signature=${findingSignature} session=${selectedSession} ${details}`.slice(0, 1200),
      assignedTo: findingRole,
      status: 'backlog', priority: anomalies.length ? 'high' : 'medium',
      sessionId: selectedSession, localOnly: true, source: 'debug-finding',
    });
    const agent = liveAgents[findingRole];
    addEvent({ agentId: findingRole, agentName: agent.name, agentColor: agent.primaryColor,
      type: 'review', message: `[${agent.name}] Debug Finding 생성: ${anomalies.length} anomaly · local-only`,
      sessionId: selectedSession, metadata: { task_title: title, finding_signature: findingSignature }, localOnly: true });
    markFinding(findingSignature);
  }

  function exportSession() {
    if (!selectedSession) return;
    const bundle = createSanitizedBundle(selectedSession, sessionTraces, relatedTasks, relatedEvents,
      relatedAgents, sessionCalls);
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `trace-session-${selectedSession.slice(0, 8)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    setMessage(null);
    try {
      if (calls.some(call => !call.completedAt && Date.now() - call.calledAt < 30_000)) {
        setMessage('Wait for the active agent request before entering read-only import mode.');
        return;
      }
      if (file.size > 1_000_000) { setMessage('Bundle is too large (max 1 MB).'); return; }
      const result = parseSanitizedBundle(await file.text());
      if ('error' in result) { setMessage(result.error); return; }
      clearFilters();
      setImportedBundle(result.bundle);
    } catch { setMessage('Could not read bundle safely.'); }
    finally { if (fileRef.current) fileRef.current.value = ''; }
  }

  return <section className={`trace-viewer${collapsed ? ' trace-viewer--collapsed' : ''}`}>
    <div className="trace-viewer-header">
      <button className="trace-viewer-toggle" type="button" onClick={() => setCollapsed(value => !value)} aria-expanded={!collapsed}>
        <span>TRACE CORRELATION DEBUGGER</span><strong>{filteredTraces.length}/{allTraces.length}</strong>
      </button>
      <button className="trace-refresh-btn" type="button" onClick={() => void loadTraces()} disabled={status === 'loading' || imported}>
        {status === 'loading' ? '...' : 'REFRESH'}</button>
    </div>
    {!collapsed && <div className="trace-viewer-body correlation-body">
      <div className="trace-viewer-meta"><span>{imported ? 'READ-ONLY IMPORT' : statusLabel(status, local.length)}</span>
        <span>{lastLoadedAt && !imported ? `${formatKstTime(lastLoadedAt)} KST` : `${remote.length} remote · ${local.length} local`}</span></div>
      <div className="trace-toolbar">
        <button type="button" className="trace-action-btn" onClick={() => fileRef.current?.click()}>IMPORT JSON</button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="visually-hidden" aria-label="Import sanitized trace bundle"
          onChange={event => void importFile(event.target.files?.[0])} />
        {imported && <button type="button" className="trace-action-btn" onClick={() => { setImportedBundle(null); clearFilters(); setMessage(null); }}>EXIT IMPORT</button>}
        {isLensActive(filters) && <button type="button" className="trace-action-btn" onClick={clearFilters}>CLEAR ALL</button>}
      </div>
      {imported && <div className="trace-readonly">Imported evidence is read-only. No Supabase or simulation writes.</div>}
      {message && <div className={`trace-message trace-message--${status === 'error' ? 'error' : 'unavailable'}`}>{message}</div>}
      {warnings.length > 0 && <div className="lens-warnings"><strong>⚠ LENS WARNINGS</strong>{warnings.map(warning => <p key={warning}>{warning}</p>)}</div>}

      <div className="trace-section-heading"><span>SESSIONS · grouped by session / agent / type / task</span><b>{groups.length}</b></div>
      {groups.length === 0 ? <div className="trace-empty">{allTraces.length ? 'No traces match Operations Lens.' : 'No traces yet. Ask an agent to create local evidence.'}
        {isLensActive(filters) && <button type="button" onClick={clearFilters}>Clear all</button>}</div>
        : <div className="trace-session-list">{groups.map(group => <button type="button" key={group.sessionId}
          className={`trace-session${selectedSession === group.sessionId ? ' trace-session--selected' : ''}`}
          onClick={() => selectSession(group.sessionId)} title={group.sessionId}>
          <div><strong><HighlightText text={shortSession(group.sessionId)} query={filters.sessionId} /></strong>
            <span>{group.traces.length} traces · {formatKstTime(group.latestAt)} KST</span></div>
          <small>{group.agents.map(item => item.value).join(' / ') || 'call only'} · {group.tasks[0]?.value.slice(0, 34) || 'no task metadata'}</small>
        </button>)}</div>}

      {!selectedSession && groups.length > 0 && <div className="trace-empty">Select a session to inspect its correlated timeline.</div>}
      {selectedSession && <>
        <div className="trace-selected-heading"><strong title={selectedSession}>SESSION {shortSession(selectedSession)}</strong>
          <button type="button" className="trace-action-btn" onClick={exportSession}>EXPORT SANITIZED JSON</button></div>
        {selectedGroup && <div className="trace-groups"><GroupChips label="agent" items={selectedGroup.agents} />
          <GroupChips label="type" items={selectedGroup.types} /><GroupChips label="task" items={selectedGroup.tasks} /></div>}

        <div className="trace-section-heading"><span>ANOMALIES</span><b className={anomalies.length ? 'anomaly-count' : ''}>{anomalies.length}</b></div>
        {anomalies.length === 0 ? <div className="trace-ok">✓ No anomaly rules matched this session.</div>
          : <div className="anomaly-list">{anomalies.map(anomaly => <div className="anomaly-card" key={anomaly.signature}>
            <strong>⚠ {anomaly.summary}</strong><span>Hint: {anomaly.hint}</span></div>)}</div>}
        <div className="finding-toolbar"><select aria-label="Debug finding assignee" value={findingRole} disabled={imported}
          onChange={event => setFindingRole(event.target.value as 'reviewer' | 'qa')}><option value="reviewer">reviewer</option><option value="qa">qa</option></select>
        <button type="button" className="trace-action-btn finding-btn" onClick={createFinding} disabled={imported || findingExists}>
          {imported ? 'READ-ONLY' : findingExists ? 'FINDING CREATED' : 'CREATE DEBUG FINDING'}</button></div>

        <div className="trace-section-heading"><span>CORRELATED CONTEXT</span><b>{visibleRelatedTasks.length}T / {visibleRelatedEvents.length}E / {visibleRelatedAgents.length}A</b></div>
        <div className="correlated-context">
          <div><strong>TASK QUEUE</strong>{visibleRelatedTasks.slice(0, 8).length ? visibleRelatedTasks.slice(0, 8).map(task => <p key={task.id}>
            <span>{task.status}</span> <HighlightText text={task.title} query={filters.keyword} /> · {task.assignedTo ?? '—'}</p>) : <p className="context-empty">No related task.</p>}</div>
          <div><strong>EVENT LOG</strong>{visibleRelatedEvents.length ? visibleRelatedEvents.slice(0, 8).map(event => <p key={event.id}>
            <span>{formatKstTime(event.timestamp)}</span> <HighlightText text={event.message.slice(0, 110)} query={filters.keyword} /></p>) : <p className="context-empty">No related event.</p>}</div>
          <div><strong>AGENT STATE</strong>{visibleRelatedAgents.length ? visibleRelatedAgents.map(agent => <p key={agent.id}>
            <span>{agent.id}</span> {agent.status} · {agent.currentTask?.slice(0, 48) ?? '—'}</p>) : <p className="context-empty">No related agent.</p>}</div>
        </div>

        <div className="trace-section-heading"><span>TIMELINE · chronological</span><b>{timeline.length}/{sessionTraces.length}</b></div>
        {timeline.length === 0 ? <div className="trace-empty">No timeline traces match this view.{isLensActive(filters)
          && <button type="button" onClick={clearFilters}>Clear all</button>}</div>
          : <div className="trace-timeline">{timeline.map(trace => <article className="trace-card" key={trace.id}>
            <div className="trace-card-top"><span className={`trace-badge ${badgeClass(trace.trace_type)}`}>{trace.trace_type}</span>
              <strong>{trace.agent_id}</strong><time>{formatKstTime(trace.created_at)} KST</time></div>
            {traceTaskTitle(trace) && <div className="trace-task-title"><HighlightText text={traceTaskTitle(trace)} query={filters.keyword} /></div>}
            <div className="trace-card-metrics"><span title={trace.model ?? undefined}>{trace.model ?? 'model —'}</span>
              <span>{num(trace.latency_ms, 'ms')}</span><span>in {num(trace.input_tokens)}</span><span>out {num(trace.output_tokens)}</span></div>
            <p><HighlightText text={summarizeTraceMetadata(trace.metadata)} query={filters.keyword} /></p>
          </article>)}</div>}
      </>}
    </div>}
  </section>;
}
