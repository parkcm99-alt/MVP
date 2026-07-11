'use client';

import { useState } from 'react';
import { useSimStore } from '@/store/simulationStore';
import { useDebugStore } from '@/store/debugStore';
import { getSessionId } from '@/lib/supabase/session';
import { eventBus } from '@/lib/simulation/eventBus';
import type { AgentRole, TaskPriority, TaskStatus } from '@/types';
import { lensText, useOperationsLens } from '@/store/operationsLensStore';

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
  const lens = useOperationsLens(s => s.filters);
  const visibleTasks = tasks.filter(t => (!lens.role || t.assignedTo === lens.role) && (!lens.status || t.status === lens.status) && (!lens.priority || t.priority === lens.priority) && lensText(`${t.title} ${t.description}`, lens.keyword));
  const [busyRole, setBusyRole] = useState<AgentRole | null>(null);
  const recordPlannerResponse = useDebugStore(s => s.recordPlannerResponse);
  const highlightedTaskId = useDebugStore(s => s.highlightedTaskId);

  async function askAgent(role: Exclude<AgentRole, 'planner'>) {
    if (busyRole) return;
    const task = tasks.find(item => item.assignedTo === role && item.status !== 'done')
      ?? tasks.find(item => item.status !== 'done');
    const taskTitle = task?.title ?? `${role} 검토 요청`;
    const taskDescription = task?.description ?? '현재 MVP 작업을 검토하고 다음 단계를 제안합니다.';
    const sessionId = getSessionId();
    const marker = { id: crypto.randomUUID(), sessionId, role, taskTitle, traceRecorded: null as boolean | null };
    try {
      const markers = JSON.parse(localStorage.getItem('agent-ask-markers') ?? '[]') as unknown[];
      localStorage.setItem('agent-ask-markers', JSON.stringify([marker, ...markers].slice(0, 100)));
    } catch { /* local diagnostics are best-effort */ }
    const store = useSimStore.getState();
    const previous = store.agents[role];
    setBusyRole(role);
    store.setStatus(role, role === 'developer' ? 'coding' : role === 'qa' ? 'testing' : role === 'reviewer' ? 'reviewing' : 'thinking');
    store.setSpeech(role, `${role} 분석 중...`);
    try {
      const response = await fetch(`/api/agents/${role}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskTitle, taskDescription, sessionId }),
      });
      const result = await response.json() as Record<string, unknown>;
      try {
        const markers = JSON.parse(localStorage.getItem('agent-ask-markers') ?? '[]') as Array<Record<string, unknown>>;
        localStorage.setItem('agent-ask-markers', JSON.stringify(markers.map(item => item.id === marker.id ? { ...item, traceRecorded: result.traceRecorded === true } : item)));
      } catch { /* local diagnostics are best-effort */ }
      recordPlannerResponse({
        role,
        provider: result.provider === 'claude' ? 'claude' : 'mock',
        traceRecorded: typeof result.traceRecorded === 'boolean' ? result.traceRecorded : false,
        model: typeof result.model === 'string' ? result.model : null,
        latencyMs: typeof result.latencyMs === 'number' ? result.latencyMs : null,
        inputTokens: typeof result.inputTokens === 'number' ? result.inputTokens : null,
        outputTokens: typeof result.outputTokens === 'number' ? result.outputTokens : null,
      });
      const summary = typeof result.summary === 'string' ? result.summary : '응답 완료';
      const labels: Record<string, Array<[string, string]>> = {
        architect: [['설계 검토 완료', 'summary'], ['아키텍처 노트', 'architectureNotes']],
        developer: [['구현 계획 완료', 'summary'], ['수정 예상 파일', 'filesToChange'], ['테스트 계획', 'testPlan']],
        reviewer: [['코드 리뷰 완료', 'summary'], ['수정 권장사항', 'suggestedChanges'], ['승인 상태', 'approvalStatus']],
        qa: [['테스트 계획 완료', 'summary'], ['테스트 케이스', 'testCases'], ['최종 검증 상태', 'finalStatus']],
      };
      for (const [label, key] of labels[role]) {
        const value = result[key];
        const message = Array.isArray(value) ? value.join(' · ') : String(value ?? summary);
        eventBus.emit('agent.message', { agentId: role, data: { message: `[${role[0].toUpperCase()}${role.slice(1)}] ${label}: ${message}`, provider: result.provider } });
      }
      store.setSpeech(role, summary.slice(0, 72));
      window.setTimeout(() => useSimStore.getState().setSpeech(role, null), 4500);
    } catch {
      eventBus.emit('agent.message', { agentId: role, data: { message: `[${role}] 호출 실패 — mock simulation 유지` } });
    } finally {
      const current = useSimStore.getState().agents[role];
      if (current.status !== previous.status) useSimStore.getState().setStatus(role, previous.status);
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, padding: '6px 8px' }}>
        {(['architect', 'developer', 'reviewer', 'qa'] as const).map(role => (
          <button
            key={role}
            type="button"
            disabled={busyRole !== null}
            onClick={() => { void askAgent(role); }}
            style={{ fontSize: 9, padding: '4px 3px', background: '#172033', color: '#9CCBFF', border: '1px solid #334155', borderRadius: 3 }}
          >
            {busyRole === role ? 'Working...' : role === 'architect' ? 'Review Architecture' : `Ask ${role[0].toUpperCase()}${role.slice(1)}`}
          </button>
        ))}
      </div>

      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {visibleTasks.length === 0 && <span style={{color:'#64748B'}}>No matching tasks · Clear all</span>}
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
                    boxShadow: highlightedTaskId === task.id ? '0 0 0 2px #FBBF24, 0 0 12px #FBBF2466' : undefined,
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
