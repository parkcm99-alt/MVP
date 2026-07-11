'use client';

import { useState } from 'react';
import { useSimStore } from '@/store/simulationStore';
import { useDebugStore } from '@/store/debugStore';
import { includesKeyword, useLensStore } from '@/store/lensStore';
import { eventBus } from '@/lib/simulation/eventBus';
import { getSessionId } from '@/lib/supabase/session';
import type { AgentRole, AgentStatus, TaskPriority, TaskStatus } from '@/types';

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

function formatList(value: unknown): string {
  return Array.isArray(value)
    ? value.filter(item => typeof item === 'string').slice(0, 4).join(' · ')
    : '—';
}

export default function TaskQueue() {
  const tasks = useSimStore(s => s.tasks);
  const [busyRole, setBusyRole] = useState<AgentRole | null>(null);
  const recordAgentResponse = useDebugStore(s => s.recordAgentResponse);
  const highlightedTaskTitle = useDebugStore(s => s.highlightedTaskTitle);
  const lens = useLensStore(s => s.filters);
  const visibleTasks = tasks.filter(t =>
    (!lens.role || t.assignedTo === lens.role) &&
    (!lens.status || t.status === lens.status) &&
    (!lens.priority || t.priority === lens.priority) &&
    includesKeyword(`${t.title} ${t.description}`, lens.keyword)
  );

  async function askAgent(role: Exclude<AgentRole, 'planner'>) {
    if (busyRole) return;
    const task = tasks.find(item => item.assignedTo === role && item.status !== 'done')
      ?? tasks.find(item => item.status !== 'done')
      ?? tasks[0];
    const title = task?.title ?? `${role} 검토`;
    const description = task?.description ?? '현재 MVP 작업을 검토합니다.';
    const previous = useSimStore.getState().agents[role];
    const previousStatus = previous.status;
    const previousTask = previous.currentTask;
    const workStatus: Record<Exclude<AgentRole, 'planner'>, AgentStatus> = {
      architect: 'thinking', developer: 'coding', reviewer: 'reviewing', qa: 'testing',
    };
    setBusyRole(role);
    useSimStore.getState().setStatus(role, workStatus[role]);
    useSimStore.getState().setTask(role, title);
    useSimStore.getState().setSpeech(role, `${role} 분석 중...`);
    try {
      const response = await fetch(`/api/agents/${role}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskTitle: title, taskDescription: description, sessionId: getSessionId() }),
      });
      const result = await response.json() as Record<string, unknown>;
      const provider = result.provider === 'claude' ? 'claude' : 'mock';
      recordAgentResponse({
        role,
        provider,
        traceRecorded: result.traceRecorded === true,
        model: typeof result.model === 'string' ? result.model : null,
        latencyMs: typeof result.latencyMs === 'number' ? result.latencyMs : null,
        inputTokens: typeof result.inputTokens === 'number' ? result.inputTokens : null,
        outputTokens: typeof result.outputTokens === 'number' ? result.outputTokens : null,
      });
      const summary = typeof result.summary === 'string' ? result.summary : '응답 완료';
      const lines: string[] = [`[${role[0].toUpperCase()}${role.slice(1)}] ${role === 'architect' ? '설계 검토' : role === 'developer' ? '구현 계획' : role === 'reviewer' ? '코드 리뷰' : '테스트 계획'} 완료: ${summary}`];
      if (role === 'architect') lines.push(`architectureNotes: ${formatList(result.architectureNotes)}`);
      if (role === 'developer') {
        lines.push(`[Developer] 수정 예상 파일: ${formatList(result.filesToChange)}`);
        lines.push(`[Developer] 테스트 계획: ${formatList(result.testPlan)}`);
      }
      if (role === 'reviewer') {
        lines.push(`[Reviewer] 수정 권장사항: ${formatList(result.suggestedChanges)}`);
        lines.push(`[Reviewer] 승인 상태: ${String(result.approvalStatus ?? 'needs_more_info')}`);
      }
      if (role === 'qa') {
        lines.push(`[QA] 테스트 케이스: ${formatList(result.testCases)}`);
        lines.push(`[QA] 최종 검증 상태: ${String(result.finalStatus ?? 'needs_more_testing')}`);
      }
      lines.forEach(message => eventBus.emit('agent.message', { agentId: role, data: { message } }));
      useSimStore.getState().setSpeech(role, summary.slice(0, 70));
    } catch {
      eventBus.emit('agent.message', { agentId: role, data: { message: `[${role}] API 실패 · mock simulation 유지` } });
      useSimStore.getState().setSpeech(role, '호출 실패 · mock simulation 유지');
    } finally {
      useSimStore.getState().setStatus(role, previousStatus);
      useSimStore.getState().setTask(role, previousTask);
      setBusyRole(null);
    }
  }

  const grouped: Record<TaskStatus, typeof tasks> = {
    in_progress: visibleTasks.filter(t => t.status === 'in_progress'),
    review:      visibleTasks.filter(t => t.status === 'review'),
    backlog:     visibleTasks.filter(t => t.status === 'backlog'),
    done:        visibleTasks.filter(t => t.status === 'done'),
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <span>📋 TASK QUEUE</span>
        <span className="panel-badge">{visibleTasks.length}/{tasks.length}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3, padding: '4px 6px', borderBottom: '1px solid #1e293b' }}>
        {([
          ['architect', 'Ask Architect'],
          ['developer', 'Ask Developer'],
          ['reviewer', 'Ask Reviewer'],
          ['qa', 'Ask QA'],
        ] as const).map(([role, label]) => (
          <button key={role} type="button" disabled={busyRole !== null}
            onClick={() => void askAgent(role)}
            style={{ fontSize: 9, padding: '4px', color: '#93c5fd', background: '#061122', border: '1px solid #2563eb', cursor: 'pointer' }}>
            {busyRole === role ? 'Working...' : label}
          </button>
        ))}
      </div>

      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {visibleTasks.length === 0 && <span style={{ color: '#64748b', fontSize: 10 }}>No tasks match · use Clear all</span>}
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
                    boxShadow: highlightedTaskTitle && task.title.toLowerCase().includes(highlightedTaskTitle.toLowerCase())
                      ? '0 0 0 2px #FBBF24, 0 0 12px #FBBF2466'
                      : undefined,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                    <span style={{ fontSize: 10, color: style.text, fontFamily: 'monospace', fontWeight: 'bold', lineHeight: 1.25, overflowWrap: 'anywhere' }}>
                      {lens.keyword && task.title.toLowerCase().includes(lens.keyword.toLowerCase()) ? <mark>{task.title}</mark> : task.title}
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
