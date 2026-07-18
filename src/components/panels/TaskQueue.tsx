'use client';

import { useMemo, useState } from 'react';
import LensHighlight from '@/components/debug/LensHighlight';
import { useOperationsData } from '@/hooks/useOperationsData';
import { traceTaskTitle } from '@/lib/debug/operationsLens';
import { eventBus } from '@/lib/simulation/eventBus';
import { getSessionId } from '@/lib/supabase/session';
import { useDebugStore } from '@/store/debugStore';
import { useLensStore } from '@/store/lensStore';
import { useSimStore } from '@/store/simulationStore';
import type { AnyAgentResponse } from '@/lib/llm/types';
import type { AgentRole, AgentStatus, SimTask, TaskPriority, TaskStatus } from '@/types';

const STATUS_STYLES: Record<TaskStatus, { bg: string; text: string; label: string }> = {
  backlog: { bg: '#1E293B', text: '#94A3B8', label: 'BACKLOG' },
  in_progress: { bg: '#1C3151', text: '#60A5FA', label: 'WIP' },
  review: { bg: '#2D1F47', text: '#C084FC', label: 'REVIEW' },
  done: { bg: '#14261E', text: '#34D399', label: 'DONE' },
};
const PRIORITY_COLORS: Record<TaskPriority, string> = { high: '#EF4444', medium: '#F97316', low: '#94A3B8' };
const ROLE_EMOJIS: Record<AgentRole, string> = { planner: '📋', architect: '🏗️', developer: '💻', reviewer: '🔍', qa: '🧪' };
const WORK_STATUS: Record<AgentRole, AgentStatus> = {
  planner: 'thinking', architect: 'thinking', developer: 'coding', reviewer: 'reviewing', qa: 'testing',
};
type CallableRole = Exclude<AgentRole, 'planner'>;

function formatDescription(description: string): string {
  return description.match(/original="([^"]+)"/)?.[1] ?? description;
}

function logAgent(role: CallableRole, task: SimTask, message: string, extra: Record<string, unknown> = {}) {
  eventBus.emit('agent.message', {
    agentId: role,
    data: { message, taskTitle: task.title, taskId: task.id, ...extra },
  });
}

function listSummary(items: string[]): string {
  return items.filter(Boolean).slice(0, 4).join(' · ') || '—';
}

function logResult(role: CallableRole, task: SimTask, result: AnyAgentResponse) {
  if (role === 'architect' && result.role === 'architect') {
    logAgent(role, task, `설계 검토 완료: ${result.summary}`);
    logAgent(role, task, `설계 노트: ${listSummary(result.architectureNotes)}`);
  } else if (role === 'developer' && result.role === 'developer') {
    logAgent(role, task, `구현 계획 완료: ${result.summary}`);
    logAgent(role, task, `수정 예상 파일: ${listSummary(result.filesToChange)}`);
    logAgent(role, task, `테스트 계획: ${listSummary(result.testPlan)}`);
  } else if (role === 'reviewer' && result.role === 'reviewer') {
    logAgent(role, task, `코드 리뷰 완료: ${result.summary}`);
    logAgent(role, task, `수정 권장사항: ${listSummary(result.suggestedChanges)}`);
    logAgent(role, task, `승인 상태: ${result.approvalStatus}`, { approvalStatus: result.approvalStatus });
  } else if (role === 'qa' && result.role === 'qa') {
    logAgent(role, task, `테스트 계획 완료: ${result.summary}`);
    logAgent(role, task, `테스트 케이스: ${listSummary(result.testCases)}`);
    logAgent(role, task, `최종 검증 상태: ${result.finalStatus}`, { finalStatus: result.finalStatus });
  }
}

export default function TaskQueue() {
  const { filters, tasks: allTasks, traces, filtered } = useOperationsData();
  const clearLens = useLensStore(state => state.clear);
  const selectedSessionId = useDebugStore(state => state.selectedSessionId);
  const startAgentCall = useDebugStore(state => state.startAgentCall);
  const recordAgentResponse = useDebugStore(state => state.recordAgentResponse);
  const failAgentCall = useDebugStore(state => state.failAgentCall);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const tasks = filtered.tasks;

  const selectedTitles = useMemo(() => new Set(traces
    .filter(trace => trace.session_id === selectedSessionId)
    .map(trace => traceTaskTitle(trace).trim().toLowerCase())
    .filter(Boolean)), [traces, selectedSessionId]);

  const grouped: Record<TaskStatus, SimTask[]> = {
    in_progress: tasks.filter(task => task.status === 'in_progress'),
    review: tasks.filter(task => task.status === 'review'),
    backlog: tasks.filter(task => task.status === 'backlog'),
    done: tasks.filter(task => task.status === 'done'),
  };

  async function askAgent(role: CallableRole, task: SimTask) {
    if (busyTaskId) return;
    const sessionId = getSessionId();
    const callId = startAgentCall(role, task.title, sessionId);
    const store = useSimStore.getState();
    const previous = store.agents[role];
    const activeTask = `[ask-${role}] ${task.title}`;
    setBusyTaskId(task.id);
    store.setStatus(role, WORK_STATUS[role]);
    store.setTask(role, activeTask);
    store.setSpeech(role, `${role} 분석 중...`);

    try {
      const response = await fetch(`/api/agents/${role}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskTitle: task.title, taskDescription: formatDescription(task.description), sessionId }),
      });
      const result = await response.json() as AnyAgentResponse;
      if (result.role !== role) throw new Error('unexpected_response');
      const metadata = result.role === 'reviewer'
        ? { approvalStatus: result.approvalStatus }
        : result.role === 'qa' ? { finalStatus: result.finalStatus } : {};
      recordAgentResponse(callId, {
        role,
        provider: result.provider,
        traceRecorded: result.traceRecorded ?? false,
        model: result.model,
        latencyMs: result.latencyMs,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        metadata,
      });
      logResult(role, task, result);
      const speech = `${result.provider === 'claude' ? 'Claude' : 'Mock'}: ${result.summary}`.slice(0, 72);
      store.setSpeech(role, speech);
      window.setTimeout(() => {
        if (useSimStore.getState().agents[role].speech === speech) useSimStore.getState().setSpeech(role, null);
      }, 4500);
    } catch {
      failAgentCall(callId);
      logAgent(role, task, '호출 실패. 기존 mock simulation은 계속 동작합니다.');
      store.setSpeech(role, '호출 실패 · mock workflow 유지');
    } finally {
      const current = useSimStore.getState().agents[role];
      if (current.currentTask === activeTask) {
        useSimStore.getState().setStatus(role, previous.status);
        useSimStore.getState().setTask(role, previous.currentTask);
      }
      setBusyTaskId(null);
    }
  }

  return (
    <div className="panel task-queue-panel">
      <div className="panel-header">
        <span>📋 TASK QUEUE</span>
        <div className="panel-filter-meta">
          <span className="panel-badge">{tasks.length}/{allTasks.length}</span>
          <button className="panel-clear-btn" type="button" onClick={clearLens}>Clear all</button>
        </div>
      </div>

      <div className="panel-body task-queue-body">
        {tasks.length === 0 && (
          <div className="lens-empty">No matching tasks. <button type="button" onClick={clearLens}>Clear all</button></div>
        )}
        {(['in_progress', 'review', 'backlog', 'done'] as TaskStatus[]).map(status => {
          const group = grouped[status];
          if (!group.length) return null;
          const style = STATUS_STYLES[status];
          return (
            <div key={status}>
              <div className="task-group-label">— {style.label} ({group.length}) —</div>
              {group.map(task => {
                const highlighted = Boolean(selectedSessionId && selectedTitles.has(task.title.trim().toLowerCase()));
                const callableRole: CallableRole | null = task.assignedTo && task.assignedTo !== 'planner'
                  ? task.assignedTo : null;
                return (
                  <article
                    key={task.id}
                    className={`task-card${highlighted ? ' task-card--correlated' : ''}`}
                    style={{ background: style.bg, borderColor: `${style.text}33`, borderLeftColor: style.text }}
                  >
                    <div className="task-card-title-row">
                      <strong style={{ color: style.text }}><LensHighlight text={task.title} query={filters.keyword} /></strong>
                      <span style={{ color: PRIORITY_COLORS[task.priority] }}>
                        {'●'.repeat(task.priority === 'high' ? 3 : task.priority === 'medium' ? 2 : 1)}
                      </span>
                    </div>
                    <div className="task-card-description"><LensHighlight text={formatDescription(task.description)} query={filters.keyword} /></div>
                    <div className="task-card-footer">
                      <span>{task.assignedTo ? `${ROLE_EMOJIS[task.assignedTo]} ${task.assignedTo}` : 'unassigned'}{task.localOnly ? ' · LOCAL' : ''}</span>
                      {callableRole && (
                        <button
                          className="ask-agent-btn"
                          type="button"
                          disabled={Boolean(busyTaskId)}
                          onClick={() => { void askAgent(callableRole, task); }}
                        >
                          {busyTaskId === task.id ? 'Asking...' : `Ask ${callableRole === 'qa' ? 'QA' : callableRole.charAt(0).toUpperCase() + callableRole.slice(1)}`}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
