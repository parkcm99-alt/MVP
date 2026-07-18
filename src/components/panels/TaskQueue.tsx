'use client';

import { useState } from 'react';
import HighlightText from '@/components/debug/HighlightText';
import { askSpecialist } from '@/lib/agents/askAgent';
import { mergeTraces, taskMatchesTrace, traceTaskTitle } from '@/lib/debug/correlation';
import { applyOperationsLens } from '@/lib/debug/operationsLens';
import { useDebugStore } from '@/store/debugStore';
import { hasActiveFilters, useOperationsStore } from '@/store/operationsStore';
import { useSimStore } from '@/store/simulationStore';
import type { SpecialistRole } from '@/lib/llm/types';
import type { SimTask, TaskPriority, TaskStatus } from '@/types';

const STATUS_STYLES: Record<TaskStatus, { bg: string; text: string; label: string }> = {
  backlog: { bg: '#1E293B', text: '#94A3B8', label: 'BACKLOG' },
  in_progress: { bg: '#1C3151', text: '#60A5FA', label: 'WIP' },
  review: { bg: '#2D1F47', text: '#C084FC', label: 'REVIEW' },
  done: { bg: '#14261E', text: '#34D399', label: 'DONE' },
};
const PRIORITY_COLORS: Record<TaskPriority, string> = { high: '#EF4444', medium: '#F97316', low: '#94A3B8' };
const ROLE_EMOJIS: Record<string, string> = { planner: '📋', architect: '🏗️', developer: '💻', reviewer: '🔍', qa: '🧪' };
const ASK_LABELS: Record<SpecialistRole, string> = {
  architect: 'Ask Architect', developer: 'Ask Developer', reviewer: 'Ask Reviewer', qa: 'Ask QA',
};

function formatDescription(description: string): string {
  return description.match(/original="([^"]+)"/)?.[1] ?? description;
}

export default function TaskQueue() {
  const tasks = useSimStore(state => state.tasks);
  const events = useSimStore(state => state.events);
  const remote = useDebugStore(state => state.remoteTraces);
  const local = useDebugStore(state => state.localTraces);
  const selectedSession = useDebugStore(state => state.selectedSessionId);
  const imported = useDebugStore(state => state.importedBundle);
  const filters = useOperationsStore(state => state.filters);
  const clear = useOperationsStore(state => state.clearFilters);
  const [busy, setBusy] = useState<string | null>(null);
  const traces = mergeTraces(remote, local);
  const filtered = applyOperationsLens(filters, tasks, events, traces).tasks;
  const active = hasActiveFilters(filters);

  async function ask(role: SpecialistRole, task: SimTask) {
    setBusy(task.id);
    try { await askSpecialist(role, task); } finally { setBusy(null); }
  }

  return (
    <section className="panel task-queue-panel">
      <div className="panel-header">
        <span>📋 TASK QUEUE</span>
        <div className="panel-header-actions"><span className="panel-badge">{filtered.length}/{tasks.length}</span>{active && <button type="button" className="panel-clear-btn" onClick={clear}>CLEAR</button>}</div>
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {filtered.length === 0 && <div className="lens-empty">{tasks.length ? 'No tasks match this lens.' : 'No tasks yet.'}{active && <button type="button" onClick={clear}>Clear all</button>}</div>}
        {(['in_progress', 'review', 'backlog', 'done'] as TaskStatus[]).map(status => {
          const group = filtered.filter(task => task.status === status);
          if (!group.length) return null;
          const style = STATUS_STYLES[status];
          return <div key={status}>
            <div style={{ fontSize: 9, color: '#475569', marginBottom: 3, letterSpacing: 1 }}>— {style.label} ({group.length}) —</div>
            {group.map(task => {
              const selected = !imported && Boolean(selectedSession && traces.some(trace => trace.session_id === selectedSession && traceTaskTitle(trace) && taskMatchesTrace(task, trace)));
              const role = task.assignedTo && task.assignedTo !== 'planner' ? task.assignedTo : null;
              return <article key={task.id} className={`task-card${selected ? ' task-card--correlated' : ''}`} style={{ background: style.bg, borderColor: `${style.text}33`, borderLeftColor: selected ? '#FBBF24' : style.text }}>
                <div className="task-card-top">
                  <strong style={{ color: style.text }}><HighlightText text={task.title} query={filters.keyword} /></strong>
                  <span style={{ color: PRIORITY_COLORS[task.priority] }}>{'●'.repeat(task.priority === 'high' ? 3 : task.priority === 'medium' ? 2 : 1)}</span>
                </div>
                <div className="task-card-detail">
                  <span><HighlightText text={formatDescription(task.description)} query={filters.keyword} /></span>
                  {task.assignedTo && <small>{ROLE_EMOJIS[task.assignedTo]} {task.assignedTo}</small>}
                </div>
                <div className="task-card-footer">
                  <div className="task-tags">{selected && <span className="task-correlated-tag">● SESSION MATCH</span>}{task.localOnly && <span className="task-local-tag">LOCAL ONLY</span>}</div>
                  {role && <button type="button" className={`ask-agent-btn ask-agent-btn--${role}`} disabled={busy !== null} onClick={() => void ask(role, task)}>{busy === task.id ? 'Working…' : ASK_LABELS[role]}</button>}
                </div>
              </article>;
            })}
          </div>;
        })}
      </div>
    </section>
  );
}
