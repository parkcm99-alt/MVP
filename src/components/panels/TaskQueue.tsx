'use client';

import { useMemo, useState } from 'react';
import HighlightText from '@/components/debug/HighlightText';
import { useOperationsLens } from '@/hooks/useOperationsLens';
import { askSpecialistAgent } from '@/lib/agents/askAgent';
import { mergeRecentTraces, normalizeMatch, taskMatchesTrace } from '@/lib/debug/correlation';
import { isLensActive } from '@/lib/debug/operationsLens';
import type { SpecialistAgentRole } from '@/lib/llm/types';
import { useDebugStore } from '@/store/debugStore';
import type { TaskPriority, TaskStatus } from '@/types';

const STATUS_STYLES: Record<TaskStatus, { bg: string; text: string; label: string }> = {
  backlog: { bg: '#1E293B', text: '#94A3B8', label: 'BACKLOG' },
  in_progress: { bg: '#1C3151', text: '#60A5FA', label: 'WIP' },
  review: { bg: '#2D1F47', text: '#C084FC', label: 'REVIEW' },
  done: { bg: '#14261E', text: '#34D399', label: 'DONE' },
};
const PRIORITY_COLORS: Record<TaskPriority, string> = { high: '#EF4444', medium: '#F97316', low: '#94A3B8' };
const ROLE_EMOJIS: Record<string, string> = { planner: '📋', architect: '🏗️', developer: '💻', reviewer: '🔍', qa: '🧪' };
const SPECIALISTS: SpecialistAgentRole[] = ['architect', 'developer', 'reviewer', 'qa'];
const ASK_LABELS: Record<SpecialistAgentRole, string> = {
  architect: 'Ask Architect', developer: 'Ask Developer', reviewer: 'Ask Reviewer', qa: 'Ask QA',
};

function formatDescription(description: string): string {
  return description.match(/original="([^"]+)"/)?.[1] ?? description;
}

export default function TaskQueue() {
  const { liveTasks: tasks, liveTaskTotal, filters, imported } = useOperationsLens();
  const clearFilters = useDebugStore(state => state.clearFilters);
  const selectedSession = useDebugStore(state => state.selectedSessionId);
  const localTraces = useDebugStore(state => state.localTraces);
  const remoteTraces = useDebugStore(state => state.remoteTraces);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const importedTraces = useDebugStore(state => state.importedBundle?.traces);
  const sessionTraces = useMemo(() => !selectedSession ? []
    : (imported && importedTraces ? importedTraces : mergeRecentTraces(remoteTraces, localTraces))
      .filter(trace => trace.session_id === selectedSession),
  [imported, importedTraces, selectedSession, remoteTraces, localTraces]);

  const grouped: Record<TaskStatus, typeof tasks> = {
    in_progress: tasks.filter(task => task.status === 'in_progress'),
    review: tasks.filter(task => task.status === 'review'),
    backlog: tasks.filter(task => task.status === 'backlog'),
    done: tasks.filter(task => task.status === 'done'),
  };

  return (
    <div className="panel task-queue-panel">
      <div className="panel-header">
        <span>📋 TASK QUEUE</span>
        <div className="panel-header-tools"><span className="panel-badge">{tasks.length}/{liveTaskTotal}</span>
          {isLensActive(filters) && <button type="button" className="panel-clear-btn" onClick={clearFilters}>CLEAR</button>}
        </div>
      </div>
      <div className="panel-body task-queue-body">
        {tasks.length === 0 && <div className="lens-empty">{liveTaskTotal === 0 ? 'No tasks yet.' : 'No tasks match Operations Lens.'}
          {isLensActive(filters) && <button type="button" onClick={clearFilters}>Clear all</button>}</div>}
        {(['in_progress', 'review', 'backlog', 'done'] as TaskStatus[]).map(status => {
          const group = grouped[status];
          if (!group.length) return null;
          const style = STATUS_STYLES[status];
          return <div key={status}>
            <div className="task-group-label">— {style.label} ({group.length}) —</div>
            {group.map(task => {
              const highlighted = sessionTraces.some(trace => taskMatchesTrace(task, trace));
              const role = task.assignedTo && SPECIALISTS.includes(task.assignedTo as SpecialistAgentRole)
                ? task.assignedTo as SpecialistAgentRole : null;
              return <article key={task.id} data-task-title={task.title}
                className={`task-card${highlighted ? ' task-card--correlated' : ''}${task.localOnly ? ' task-card--local' : ''}`}
                style={{ background: style.bg, borderColor: `${style.text}33`, borderLeftColor: highlighted ? '#FBBF24' : style.text }}>
                <div className="task-card-top">
                  <strong style={{ color: style.text }}><HighlightText text={task.title} query={filters.keyword} /></strong>
                  <span style={{ color: PRIORITY_COLORS[task.priority] }}>{'●'.repeat(task.priority === 'high' ? 3 : task.priority === 'medium' ? 2 : 1)}</span>
                </div>
                <div className="task-description"><HighlightText text={formatDescription(task.description)} query={filters.keyword} /></div>
                <div className="task-card-bottom">
                  <span>{task.assignedTo ? `${ROLE_EMOJIS[task.assignedTo]} ${task.assignedTo}` : 'unassigned'}{task.localOnly ? ' · LOCAL' : ''}{highlighted ? ' · TRACE MATCH' : ''}</span>
                  {role && !imported && !task.localOnly && <button type="button" className="task-ask-btn" disabled={busyTaskId !== null}
                    onClick={() => {
                      setBusyTaskId(task.id);
                      void askSpecialistAgent(role, task).finally(() => setBusyTaskId(null));
                    }}>{busyTaskId === task.id ? 'ASKING...' : ASK_LABELS[role]}</button>}
                </div>
              </article>;
            })}
          </div>;
        })}
        {selectedSession && sessionTraces.length > 0 && tasks.length > 0
          && !tasks.some(task => sessionTraces.some(trace => taskMatchesTrace(task, trace)))
          && <div className="task-correlation-note">Selected session has no title-matched task in this view.</div>}
        {filters.keyword && tasks.length > 0 && !tasks.some(task => normalizeMatch(task.title).includes(normalizeMatch(filters.keyword)))
          && <div className="task-correlation-note">Keyword may match task details instead of titles.</div>}
      </div>
    </div>
  );
}
