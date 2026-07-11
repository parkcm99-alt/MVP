'use client';

import { useSimStore } from '@/store/simulationStore';
import type { TaskPriority, TaskStatus } from '@/types';
import { useDebugStore } from '@/store/debugStore';
import { lensTextMatch, useOperationsLens } from '@/store/operationsLensStore';
import LensHighlight from '@/components/debug/LensHighlight';
import { getSessionId } from '@/lib/supabase/session';

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
  const highlightedTaskId = useDebugStore(s => s.highlightedTaskId);
  const lens = useOperationsLens();
  const filteredTasks = tasks.filter(t =>
    (!lens.sessionId || getSessionId().includes(lens.sessionId)) &&
    (!lens.role || t.assignedTo === lens.role) &&
    (!lens.status || t.status === lens.status) &&
    (!lens.priority || t.priority === lens.priority) &&
    lensTextMatch(`${t.title} ${t.description} ${t.assignedTo ?? ''}`, lens.keyword)
  );

  const grouped: Record<TaskStatus, typeof tasks> = {
    in_progress: filteredTasks.filter(t => t.status === 'in_progress'),
    review:      filteredTasks.filter(t => t.status === 'review'),
    backlog:     filteredTasks.filter(t => t.status === 'backlog'),
    done:        filteredTasks.filter(t => t.status === 'done'),
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <span>📋 TASK QUEUE</span>
        <span className="panel-badge">{filteredTasks.length}/{tasks.length}</span>
      </div>

      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {filteredTasks.length === 0 && <span style={{color:'#64748b',fontSize:10}}>No tasks match · <button onClick={lens.clearAll}>Clear all</button></span>}
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
                    border: task.id === highlightedTaskId ? '2px solid #FACC15' : `1px solid ${style.text}33`,
                    boxShadow: task.id === highlightedTaskId ? '0 0 10px #FACC1566' : undefined,
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
                      <LensHighlight text={task.title} keyword={lens.keyword} />
                    </span>
                    <span style={{ fontSize: 8, color: PRIORITY_COLORS[task.priority], fontFamily: 'monospace', flexShrink: 0 }}>
                      {'●'.repeat(task.priority === 'high' ? 3 : task.priority === 'medium' ? 2 : 1)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                    <span style={{ fontSize: 9, color: '#64748B', fontFamily: 'monospace', lineHeight: 1.25, overflowWrap: 'anywhere' }}>
                      <LensHighlight text={formatDescription(task.description)} keyword={lens.keyword} />
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
