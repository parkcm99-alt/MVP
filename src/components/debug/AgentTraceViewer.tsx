'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  eventRelatesToTask,
  lensIsActive,
  matchesTask,
  matchesTrace,
  sessionMatches,
  traceRelatesToEvent,
  traceRelatesToTask,
  traceTaskTitle,
} from '@/lib/debug/operationsLens';
import {
  findTraceAnomalies,
  makeSanitizedBundle,
  MAX_IMPORT_BYTES,
  parseSanitizedBundle,
  safeMetadataSummary,
  TRACE_LIMIT,
} from '@/lib/debug/traceCorrelation';
import { getSupabaseClient } from '@/lib/supabase/client';
import { getSessionId } from '@/lib/supabase/session';
import type { AgentTraceRow } from '@/lib/supabase/types';
import { formatKstTime } from '@/lib/time';
import { useDebugStore } from '@/store/debugStore';
import { useLensStore } from '@/store/lensStore';
import { useSimStore } from '@/store/simulationStore';
import LensHighlight from './LensHighlight';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

function badge(type: string): string {
  return type === 'llm_call' ? 'trace-badge--llm'
    : type === 'handoff' ? 'trace-badge--handoff'
    : type === 'decision' ? 'trace-badge--decision'
    : type === 'tool_use' ? 'trace-badge--tool' : 'trace-badge--unknown';
}

function newestFirst(rows: AgentTraceRow[]): AgentTraceRow[] {
  return [...new Map(rows.map(row => [row.id, row])).values()]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, TRACE_LIMIT);
}

function localStateTraces(): AgentTraceRow[] {
  const now = new Date().toISOString();
  return Object.values(useSimStore.getState().agents)
    .filter(agent => agent.currentTask)
    .map(agent => ({
      id: `local-state-${agent.id}`,
      session_id: getSessionId(),
      agent_id: agent.id,
      trace_type: 'decision',
      input_tokens: null,
      output_tokens: null,
      latency_ms: null,
      model: 'local',
      metadata: { task_title: agent.currentTask, status: agent.status, source: 'local_state' },
      created_at: now,
    }));
}

export default function AgentTraceViewer({ refreshKey = null }: { refreshKey?: number | null }) {
  const [collapsed, setCollapsed] = useState(false);
  const [status, setStatus] = useState<LoadState>('idle');
  const [traces, setTraces] = useState<AgentTraceRow[]>([]);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const findingKeysRef = useRef(new Set<string>());
  const tasks = useSimStore(state => state.tasks);
  const events = useSimStore(state => state.events);
  const agents = useSimStore(state => state.agents);
  const addLocalTask = useSimStore(state => state.addLocalTask);
  const addEvent = useSimStore(state => state.addEvent);
  const localTraceRows = useDebugStore(state => state.localTraces);
  const setHighlights = useDebugStore(state => state.setHighlightedTaskTitles);
  const setObservedTraces = useDebugStore(state => state.setObservedTraces);
  const lens = useLensStore(state => state.filters);
  const clearLens = useLensStore(state => state.clearAll);
  const currentSession = getSessionId();

  const load = useCallback(async () => {
    setStatus('loading');
    setError(null);
    setNotice(null);
    setReadOnly(false);
    const local = useDebugStore.getState().localTraces;
    const supabase = getSupabaseClient();
    if (!supabase) {
      const rows = newestFirst([...local, ...localStateTraces()]);
      setTraces(rows);
      setSelected(previous => previous && rows.some(row => row.session_id === previous)
        ? previous : rows[0]?.session_id ?? getSessionId());
      setStatus('ready');
      return;
    }

    const { data, error: queryError } = await supabase.from('agent_traces')
      .select('id,session_id,agent_id,trace_type,input_tokens,output_tokens,latency_ms,model,metadata,created_at')
      .order('created_at', { ascending: false })
      .limit(TRACE_LIMIT);
    if (queryError) {
      console.warn('[Supabase] agent_traces query failed:', queryError.message);
      const rows = newestFirst([...local, ...localStateTraces()]);
      setTraces(rows);
      setSelected(previous => previous && rows.some(row => row.session_id === previous)
        ? previous : rows[0]?.session_id ?? getSessionId());
      setError('Trace 조회 실패 · local analysis로 계속합니다.');
      setStatus('error');
      return;
    }
    const rows = newestFirst([...local, ...((data ?? []) as AgentTraceRow[])]);
    setTraces(rows);
    setSelected(previous => previous && rows.some(row => row.session_id === previous)
      ? previous : rows[0]?.session_id ?? '');
    setStatus('ready');
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, refreshKey]);
  // Workflow handoff/decision fallback traces can arrive after the API response refresh.
  useEffect(() => {
    if (!readOnly && localTraceRows.length) {
      const timer = window.setTimeout(() => setTraces(previous => newestFirst([...localTraceRows, ...previous])), 0);
      return () => window.clearTimeout(timer);
    }
  }, [localTraceRows, readOnly]);
  useEffect(() => {
    if (!readOnly) setObservedTraces(traces);
  }, [traces, readOnly, setObservedTraces]);

  const sessions = useMemo(() => [...new Set(traces.map(trace => trace.session_id))], [traces]);
  const matchingSessions = lens.sessionId.trim()
    ? sessions.filter(session => sessionMatches(session, lens.sessionId, currentSession))
    : sessions;
  const activeSession = matchingSessions.includes(selected) ? selected : matchingSessions[0] ?? selected;
  const sessionTraces = useMemo(() => traces.filter(trace => trace.session_id === activeSession), [traces, activeSession]);
  const active = useMemo(() => sessionTraces
    .filter(trace => matchesTrace(trace, lens, readOnly ? [] : tasks, currentSession))
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)),
  [sessionTraces, lens, tasks, currentSession, readOnly]);
  const anomalies = useMemo(() => findTraceAnomalies(sessionTraces), [sessionTraces]);
  const groups = useMemo(() => {
    const grouped = new Map<string, number>();
    for (const trace of active) {
      const key = `${trace.agent_id} / ${trace.trace_type} / ${traceTaskTitle(trace) || '—'}`;
      grouped.set(key, (grouped.get(key) ?? 0) + 1);
    }
    return [...grouped.entries()];
  }, [active]);

  // Context uses the complete chosen session, not the current Lens subset.
  const relatedTasks = useMemo(() => readOnly ? [] : tasks.filter(task => sessionTraces
    .some(trace => traceRelatesToTask(trace, task, currentSession))),
  [readOnly, tasks, sessionTraces, currentSession]);
  const relatedEvents = useMemo(() => readOnly ? [] : events.filter(event => sessionTraces
    .some(trace => traceRelatesToEvent(trace, event, currentSession))
    || relatedTasks.some(task => eventRelatesToTask(event, task, currentSession))).slice(0, 8),
  [readOnly, events, sessionTraces, relatedTasks, currentSession]);
  const relatedAgents = useMemo(() => readOnly ? [] : Object.values(agents)
    .filter(agent => sessionTraces.some(trace => trace.agent_id === agent.id)),
  [readOnly, agents, sessionTraces]);

  const lensWarnings = useMemo(() => {
    if (readOnly || !lensIsActive(lens)) return [];
    const warnings: string[] = [];
    const queriedTraces = traces.filter(trace => sessionMatches(trace.session_id, lens.sessionId, currentSession));
    const candidateTasks = tasks.filter(task => matchesTask(task, { ...lens, traceType: '' }, traces, currentSession));
    const noEvent = candidateTasks.filter(task => !events.some(event => eventRelatesToTask(event, task, currentSession))).length;
    const noTrace = candidateTasks.filter(task => !queriedTraces.some(trace => traceRelatesToTask(trace, task, currentSession))).length;
    if (noEvent) warnings.push(`${noEvent} matching task에 관련 event가 없습니다. · 작업 시작 로그를 확인하세요.`);
    if (noTrace) warnings.push(`${noTrace} matching task에 관련 trace가 없습니다. · Refresh 또는 trace 권한을 확인하세요.`);
    if (lens.sessionId.trim()
      && !traces.some(trace => sessionMatches(trace.session_id, lens.sessionId, currentSession))
      && !tasks.some(task => sessionMatches(task.sessionId, lens.sessionId, currentSession))
      && !events.some(event => sessionMatches(event.sessionId, lens.sessionId, currentSession))) {
      warnings.push('SessionId와 일치하는 task/event/trace가 없습니다. · session 필터를 확인하세요.');
    }
    if (lens.role && queriedTraces.length > 0 && !queriedTraces.some(trace => trace.agent_id === lens.role)) {
      warnings.push('선택 session의 trace에 해당 agent role이 없습니다. · role/session 조합을 확인하세요.');
    }
    return warnings;
  }, [readOnly, lens, traces, tasks, events, currentSession]);

  useEffect(() => {
    setHighlights(readOnly ? [] : active.map(traceTaskTitle).filter(Boolean));
    return () => setHighlights([]);
  }, [readOnly, active, setHighlights]);

  function createFinding() {
    if (readOnly || !activeSession) return;
    const anomaly = anomalies.find(item => {
      const key = `trace-finding:v1:${activeSession}:${item.signature}`;
      if (findingKeysRef.current.has(key)) return false;
      try { return !localStorage.getItem(key); } catch { return true; }
    });
    if (!anomaly) {
      setNotice('동일한 session/anomaly finding이 이미 있습니다.');
      return;
    }
    const key = `trace-finding:v1:${activeSession}:${anomaly.signature}`;
    findingKeysRef.current.add(key);
    addLocalTask({
      title: `Trace finding: ${anomaly.summary}`.slice(0, 44),
      description: `${anomaly.summary}\nHint: ${anomaly.hint}\n[local-only] session=${activeSession}`,
      assignedTo: anomaly.role,
      status: 'backlog',
      priority: 'high',
      sessionId: activeSession,
    });
    addEvent({
      agentId: anomaly.role,
      agentName: anomaly.role === 'qa' ? 'QA' : 'Reviewer',
      agentColor: '#F59E0B',
      type: 'review',
      message: `[Trace Debug] ${anomaly.summary}`,
      sessionId: activeSession,
    });
    try { localStorage.setItem(key, '1'); } catch { /* storage unavailable: in-memory guard remains */ }
    setNotice('Local-only debug finding task 1개를 생성했습니다.');
  }

  function exportBundle() {
    if (!activeSession || !sessionTraces.length) return;
    const bundle = makeSanitizedBundle(activeSession, sessionTraces);
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `trace-${activeSession}.sanitized.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice('Sanitized JSON Bundle을 내보냈습니다. 공유 전 내용을 확인하세요.');
  }

  async function importBundle(file?: File) {
    if (!file) return;
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error('invalid_bundle');
      const bundle = parseSanitizedBundle(await file.text());
      if (!bundle) throw new Error('invalid_bundle');
      setTraces(newestFirst(bundle.traces));
      setSelected(bundle.sessionId);
      setReadOnly(true);
      setStatus('ready');
      setError(null);
      setNotice('Read-only analysis mode · live task/event context와 쓰기는 비활성화됩니다.');
      setHighlights([]);
    } catch {
      setError('손상된 JSON 또는 지원하지 않는 schema version입니다.');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <section className={`trace-viewer${collapsed ? ' trace-viewer--collapsed' : ''}`}>
      <div className="trace-viewer-header">
        <button className="trace-viewer-toggle" type="button" onClick={() => setCollapsed(value => !value)} aria-expanded={!collapsed}>
          <span>TRACE CORRELATION DEBUGGER</span><strong>{active.length}/{sessionTraces.length}</strong>
        </button>
        <button className="trace-refresh-btn" type="button" onClick={clearLens}>CLEAR ALL</button>
        <button className="trace-refresh-btn" type="button" onClick={() => void load()} disabled={status === 'loading'}>REFRESH</button>
      </div>
      {!collapsed && (
        <div className="trace-viewer-body">
          <div className="trace-viewer-meta">
            <span>{readOnly ? 'READ-ONLY IMPORT' : status === 'error' ? 'LOCAL FALLBACK' : status.toUpperCase()}</span>
            <span>{active.length}/{sessionTraces.length} filtered · {sessions.length} sessions · {anomalies.length} anomalies</span>
          </div>
          {error && <div className="trace-message trace-message--error">{error}</div>}
          {notice && <div className="trace-message trace-message--unavailable">{notice}</div>}
          <select className="trace-session-select" aria-label="Trace session" value={activeSession} onChange={event => setSelected(event.target.value)}>
            <option value="">Select session</option>
            {sessions.map(session => <option key={session} value={session}>{session}</option>)}
          </select>
          <div className="trace-actions">
            <button className="trace-refresh-btn" type="button" onClick={createFinding} disabled={readOnly || !anomalies.length}>CREATE DEBUG FINDING</button>
            <button className="trace-refresh-btn" type="button" onClick={exportBundle} disabled={!sessionTraces.length}>EXPORT</button>
            <button className="trace-refresh-btn" type="button" onClick={() => inputRef.current?.click()}>IMPORT</button>
            <input ref={inputRef} hidden type="file" accept="application/json,.json" onChange={event => void importBundle(event.target.files?.[0])} />
          </div>
          {lensWarnings.map(warning => <div key={warning} className="trace-message trace-message--unavailable"><strong>Lens warning:</strong> {warning}</div>)}
          {anomalies.map(anomaly => (
            <div key={anomaly.signature} className="trace-message trace-message--error">
              <strong>{anomaly.summary}</strong><br />Hint: {anomaly.hint}
            </div>
          ))}
          {groups.length > 0 && (
            <div className="trace-groups">
              <strong>GROUPS · agent / type / task</strong>
              {groups.map(([group, count]) => <span key={group}><LensHighlight text={group} keyword={lens.keyword} /> ({count})</span>)}
            </div>
          )}
          {active.length === 0 && <div className="trace-empty">No traces match · use Clear all</div>}
          <div className="trace-list">
            {active.map(trace => (
              <article className="trace-card" key={trace.id}>
                <div className="trace-card-top">
                  <span className={`trace-badge ${badge(trace.trace_type)}`}>{trace.trace_type}</span>
                  <strong><LensHighlight text={trace.agent_id} keyword={lens.keyword} /></strong>
                  <time>{formatKstTime(trace.created_at)} KST</time>
                </div>
                <div className="trace-card-metrics">
                  <span><LensHighlight text={trace.model ?? 'model —'} keyword={lens.keyword} /></span>
                  <span>{trace.latency_ms ?? '—'}ms</span><span>in {trace.input_tokens ?? '—'}</span><span>out {trace.output_tokens ?? '—'}</span>
                </div>
                <p><LensHighlight text={safeMetadataSummary(trace.metadata)} keyword={lens.keyword} /></p>
              </article>
            ))}
          </div>
          <div className="trace-context">
            <strong>SESSION CONTEXT</strong>
            {readOnly ? <span>Imported bundle only · live Task Queue/Event Log/agent state unavailable.</span> : <>
              <span><b>TASKS:</b> {relatedTasks.map(task => task.title).join(' · ') || '—'}</span>
              <span><b>EVENT LOG:</b> {relatedEvents.map(event => event.message).join(' · ') || '—'}</span>
              <span><b>AGENTS:</b> {relatedAgents.map(agent => `${agent.id}:${agent.status}`).join(' · ') || '—'}</span>
            </>}
          </div>
        </div>
      )}
    </section>
  );
}
