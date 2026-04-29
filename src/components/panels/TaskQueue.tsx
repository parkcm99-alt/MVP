'use client';

import { useSimStore } from '@/store/simulationStore';
import type { TaskPriority, TaskStatus } from '@/types';

const STATUS_STYLES: Record<TaskStatus, { bg: string; text: string; label: string }> = {
  backlog:     { bg: '#1E293B', text: '#94A3B8', label: 'BACKLOG' },
  in_progress: { bg: '#1C3151', text: '#60A5FA', label: 'WIP' },
  review:      { bg: '#2D1F47', text: '#C084FC', label: 'REVIEW' },
  done:        { bg: '#14261E', text: '#34D399', label: 'DONE' },
};

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  high:   '#EF4444',
  medium: '#F97316',
  low:    '#94A3B8',
};

const ROLE_EMOJIS: Record<string, string> = {
  planner: '📋', architect: '🏗️', developer: '💻', reviewer: '🔍', qa: '🧪',
};

function formatDescription(description: string): string {
  const original = description.match(/original="([^"]+)"/)?.[1];
  if (original) return original;
  return description;
}

export default function TaskQueue() {
  const tasks = useSimStore(s => s.tasks);

  const grouped: Record<TaskStatus, typeof tasks> = {
    in_progress: tasks.filter(t => t.status === 'in_progress'),
    review:      tasks.filter(t => t.status === 'review'),
    backlog:     tasks.filter(t => t.status === 'backlog'),
    done:        tasks.filter(t => t.status === 'done'),
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <span>📋 TASK QUEUE</span>
        <span className="panel-badge">{tasks.length}</span>
      </div>

      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {(['in_progress', 'review', 'backlog', 'done'] as TaskStatus[]).map(status => {
          const group = grouped[status];
          if (group.length === 0) return null;
          const style = STATUS_STYLES[status];
          return (
            <div key={status}>
              <div style={{ fontSize: 9, color: '#475569', fontFamily: 'monospace', marginBottom: 3, letterSpacing: 1 }}>
                — {style.label} ({group.length}) —
              </div>
              {group.map(task => (
                <div
                  key={task.id}
                  style={{
                    background: style.bg,
                    border: `1px solid ${style.text}33`,
                    borderLeft: `3px solid ${style.text}`,
                    borderRadius: 3,
                    padding: '5px 8px',
                    marginBottom: 3,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                    <span style={{ fontSize: 10, color: style.text, fontFamily: 'monospace', fontWeight: 'bold', lineHeight: 1.25, overflowWrap: 'anywhere' }}>
                      {task.title}
                    </span>
                    <span style={{ fontSize: 8, color: PRIORITY_COLORS[task.priority], fontFamily: 'monospace', flexShrink: 0 }}>
                      {'●'.repeat(task.priority === 'high' ? 3 : task.priority === 'medium' ? 2 : 1)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                    <span style={{ fontSize: 9, color: '#64748B', fontFamily: 'monospace', lineHeight: 1.25, overflowWrap: 'anywhere' }}>
                      {formatDescription(task.description)}
                    </span>
                    {task.assignedTo && (
                      <span style={{ fontSize: 9, color: '#64748B', fontFamily: 'monospace', flexShrink: 0 }}>
                        {ROLE_EMOJIS[task.assignedTo]} {task.assignedTo}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
