'use client';

import { useState } from 'react';
import HighlightText from '@/components/debug/HighlightText';
import { filterTasks, hasActiveFilters } from '@/lib/debug/lens';
import type { AgentApiResponse } from '@/lib/llm/types';
import { eventBus } from '@/lib/simulation/eventBus';
import { getSessionId } from '@/lib/supabase/session';
import { useDebugStore } from '@/store/debugStore';
import { useOperationsStore } from '@/store/operationsStore';
import { useSimStore } from '@/store/simulationStore';
import type { AgentRole, AgentStatus, SimTask, TaskPriority, TaskStatus } from '@/types';

const STATUS_STYLES: Record<TaskStatus, { bg: string; text: string; label: string }> = {
  backlog:     { bg: '#1E293B', text: '#94A3B8', label: 'BACKLOG' },
  in_progress: { bg: '#1C3151', text: '#60A5FA', label: 'WIP' },
  review:      { bg: '#2D1F47', text: '#C084FC', label: 'REVIEW' },
  done:        { bg: '#14261E', text: '#34D399', label: 'DONE' },
};

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  high: '#EF4444', medium: '#F97316', low: '#94A3B8',
};

const ROLE_EMOJIS: Record<AgentRole, string> = {
  planner: '📋', architect: '🏗️', developer: '💻', reviewer: '🔍', qa: '🧪',
};

type CallableRole = Exclude<AgentRole, 'planner'>;
const CALLABLE_ROLES: CallableRole[] = ['architect', 'developer', 'reviewer', 'qa'];
const WORK_STATUS: Record<CallableRole, AgentStatus> = {
  architect: 'thinking', developer: 'coding', reviewer: 'reviewing', qa: 'testing',
};
const ROLE_LABEL: Record<CallableRole, string> = {
  architect: 'Architect', developer: 'Developer', reviewer: 'Reviewer', qa: 'QA',
};

function displayDescription(description: string): string {
  return description.replace(/^\[planner-generated\]\s*/i, '');
}

function abbreviateList(items: string[]): string {
  return items.slice(0, 4).join(' · ') || '없음';
}

function taskIsPlannerGenerated(task: SimTask): boolean {
  return task.source === 'planner-generated' || task.description.includes('[planner-generated]');
}

function completionStatus(result: AgentApiResponse): TaskStatus {
  if (result.role === 'qa') return result.finalStatus === 'passed' ? 'done' : 'review';
  if (result.role === 'reviewer') return result.approvalStatus === 'approved' ? 'done' : 'review';
  return 'review';
}

/** Keep the event payload correlated while the text remains readable in the existing Event Log. */
function logAgentResult(result: AgentApiResponse, taskTitle: string) {
  const context = { task_title: taskTitle, taskTitle, provider: result.provider };
  const emit = (message: string, extra: Record<string, unknown> = {}) => eventBus.emit('agent.message', {
    agentId: result.role,
    data: { ...context, ...extra, message },
  });

  switch (result.role) {
    case 'architect':
      emit(`설계 검토 완료: ${result.summary}`);
      emit(`Architecture Notes: ${abbreviateList(result.architectureNotes)}`);
      break;
    case 'developer':
      emit(`구현 계획 완료: ${result.summary}`);
      emit(`수정 예상 파일: ${abbreviateList(result.filesToChange)}`);
      emit(`테스트 계획: ${abbreviateList(result.testPlan)}`);
      break;
    case 'reviewer':
      emit(`코드 리뷰 완료: ${result.summary}`);
      emit(`수정 권장사항: ${abbreviateList(result.suggestedChanges)}`);
      emit(`승인 상태: ${result.approvalStatus}`, { approvalStatus: result.approvalStatus });
      break;
    case 'qa':
      emit(`테스트 계획 완료: ${result.summary}`);
      emit(`테스트 케이스: ${abbreviateList(result.testCases)}`);
      emit(`최종 검증 상태: ${result.finalStatus}`, { finalStatus: result.finalStatus });
      break;
    default:
      break;
  }
}

export default function TaskQueue() {
  const tasks = useSimStore(state => state.tasks);
  const filters = useOperationsStore(state => state.filters);
  const traces = useOperationsStore(state => state.traces);
  const selectedSessionId = useOperationsStore(state => state.selectedSessionId);
  const highlightedTaskTitles = useOperationsStore(state => state.highlightedTaskTitles);
  const clearFilters = useOperationsStore(state => state.clearFilters);
  const readOnlyAnalysis = useOperationsStore(state => state.readOnlyAnalysis);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  const visibleTasks = filterTasks(tasks, traces, filters);
  const grouped: Record<TaskStatus, SimTask[]> = {
    in_progress: visibleTasks.filter(task => task.status === 'in_progress'),
    review: visibleTasks.filter(task => task.status === 'review'),
    backlog: visibleTasks.filter(task => task.status === 'backlog'),
    done: visibleTasks.filter(task => task.status === 'done'),
  };

  async function askAgent(task: SimTask, role: CallableRole) {
    if (busyTaskId || readOnlyAnalysis) return;
    const store = useSimStore.getState();
    const previous = store.agents[role];
    const previousStatus = previous.status;
    const previousTask = previous.currentTask;
    const previousTaskStatus = task.status;
    const activeTask = `Ask ${ROLE_LABEL[role]}: ${task.title}`;
    const sessionId = getSessionId();
    const callId = useDebugStore.getState().startAgentCall(role, task.title, sessionId);
    const managedByPlannerWorkflow = taskIsPlannerGenerated(task);

    setBusyTaskId(task.id);
    store.setStatus(role, WORK_STATUS[role]);
    store.setTask(role, activeTask);
    store.setSpeech(role, `${ROLE_LABEL[role]} 검토 중: ${task.title}`.slice(0, 70));
    if (!managedByPlannerWorkflow && task.status !== 'done') store.updateTask(task.id, { status: 'in_progress' });

    try {
      const response = await fetch(`/api/agents/${role}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskTitle: task.title, taskDescription: displayDescription(task.description), sessionId }),
      });
      const result = await response.json() as AgentApiResponse;
      if (!response.ok || !result.ok || result.role !== role) throw new Error('invalid_response');

      useDebugStore.getState().recordAgentResponse(callId, result);
      logAgentResult(result, task.title);
      if (!managedByPlannerWorkflow && previousTaskStatus !== 'done') {
        store.updateTask(task.id, { status: completionStatus(result) });
      }
      const speech = `${result.provider === 'claude' ? 'Claude' : 'Mock'}: ${result.summary}`.slice(0, 72);
      store.setSpeech(role, speech);
      useOperationsStore.getState().refreshContext();
      window.setTimeout(() => {
        if (useSimStore.getState().agents[role].speech === speech) useSimStore.getState().setSpeech(role, null);
      }, 4500);
    } catch {
      useDebugStore.getState().recordAgentFailure(callId);
      if (!managedByPlannerWorkflow) store.updateTask(task.id, { status: previousTaskStatus });
      eventBus.emit('agent.message', {
        agentId: role,
        data: { message: `${ROLE_LABEL[role]} 호출 실패. Mock simulation은 계속 동작합니다.`, task_title: task.title },
      });
      store.setSpeech(role, '호출 실패. Mock simulation 유지');
    } finally {
      const current = useSimStore.getState().agents[role];
      if (current.currentTask === activeTask) {
        store.setStatus(role, previousStatus);
        store.setTask(role, previousTask);
      }
      setBusyTaskId(null);
    }
  }

  return (
    <div className="panel task-queue-panel">
      <div className="panel-header">
        <span>📋 TASK QUEUE</span>
        <div className="panel-header-tools">
          <span className="panel-badge" title="filtered / total">{visibleTasks.length}/{tasks.length}</span>
          <button type="button" className="panel-clear-btn" onClick={clearFilters} disabled={!hasActiveFilters(filters)}>CLEAR ALL</button>
        </div>
      </div>

      <div className="panel-body task-queue-body">
        {visibleTasks.length === 0 && (
          <div className="lens-empty">{tasks.length ? 'No tasks match Operations Lens.' : 'No tasks yet. Add a task or plan a sprint.'}</div>
        )}
        {(['in_progress', 'review', 'backlog', 'done'] as TaskStatus[]).map(status => {
          const group = grouped[status];
          if (!group.length) return null;
          const style = STATUS_STYLES[status];
          return (
            <div key={status}>
              <div className="task-group-label">— {style.label} ({group.length}) —</div>
              {group.map(task => {
                const role = task.assignedTo;
                const callable = role && CALLABLE_ROLES.includes(role as CallableRole) ? role as CallableRole : null;
                const title = task.title.toLowerCase();
                const emphasized = Boolean(selectedSessionId
                  && (!task.sessionId || task.sessionId === selectedSessionId)
                  && highlightedTaskTitles.some(value => {
                    const match = value.toLowerCase();
                    return match && (title === match || title.includes(match) || match.includes(title));
                  }));
                return (
                  <article
                    key={task.id}
                    className={`task-card${emphasized ? ' task-card--correlated' : ''}${task.localOnly ? ' task-card--local' : ''}`}
                    style={{ background: style.bg, borderColor: `${style.text}33`, borderLeftColor: style.text }}
                  >
                    <div className="task-card-top">
                      <strong style={{ color: style.text }}><HighlightText text={task.title} query={filters.keyword} /></strong>
                      <span style={{ color: PRIORITY_COLORS[task.priority] }} title={task.priority}>
                        {'●'.repeat(task.priority === 'high' ? 3 : task.priority === 'medium' ? 2 : 1)}
                      </span>
                    </div>
                    <p className="task-description"><HighlightText text={displayDescription(task.description)} query={filters.keyword} /></p>
                    <div className="task-card-footer">
                      <span>{role ? `${ROLE_EMOJIS[role]} ${role}` : 'unassigned'}{task.localOnly ? ' · LOCAL' : ''}</span>
                      {callable && (
                        <button
                          type="button"
                          className={`ask-agent-btn ask-agent-btn--${callable}`}
                          onClick={() => { void askAgent(task, callable); }}
                          disabled={Boolean(busyTaskId) || readOnlyAnalysis}
                        >
                          {busyTaskId === task.id ? 'ASKING…' : `ASK ${ROLE_LABEL[callable].toUpperCase()}`}
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
