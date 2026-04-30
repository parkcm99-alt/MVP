'use client';

import { useState } from 'react';
import { eventBus } from '@/lib/simulation/eventBus';
import { getSessionId } from '@/lib/supabase/session';
import { useSimStore } from '@/store/simulationStore';
import { useDebugStore } from '@/store/debugStore';
import type { ArchitectAgentResponse, DeveloperAgentResponse, ReviewerAgentResponse } from '@/lib/llm/types';
import type { AgentStatus, SimTask, TaskPriority, TaskStatus } from '@/types';

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

function buildArchitectureSummary(result: ArchitectAgentResponse): string {
  const notes = result.architectureNotes.slice(0, 2).join(' ');
  return notes ? `${result.summary} | ${notes}` : result.summary;
}

function buildDeveloperSummary(result: DeveloperAgentResponse): string {
  const plan = result.implementationPlan.slice(0, 2).join(' ');
  return plan ? `${result.summary} | ${plan}` : result.summary;
}

function buildReviewerSummary(result: ReviewerAgentResponse): string {
  const findings = result.reviewFindings.slice(0, 2).join(' ');
  return findings ? `${result.summary} | ${findings}` : result.summary;
}

export default function TaskQueue() {
  const tasks = useSimStore(s => s.tasks);
  const refreshTraces = useDebugStore(s => s.refreshTraces);
  const recordAgentResponse = useDebugStore(s => s.recordAgentResponse);
  const [architectBusyTaskId, setArchitectBusyTaskId] = useState<string | null>(null);
  const [developerBusyTaskId, setDeveloperBusyTaskId] = useState<string | null>(null);
  const [reviewerBusyTaskId, setReviewerBusyTaskId] = useState<string | null>(null);

  const grouped: Record<TaskStatus, typeof tasks> = {
    in_progress: tasks.filter(t => t.status === 'in_progress'),
    review:      tasks.filter(t => t.status === 'review'),
    backlog:     tasks.filter(t => t.status === 'backlog'),
    done:        tasks.filter(t => t.status === 'done'),
  };

  async function askArchitect(task: SimTask) {
    if (architectBusyTaskId) return;

    const store = useSimStore.getState();
    const previousArchitect = store.agents.architect;
    const previousStatus: AgentStatus = previousArchitect.status;
    const previousTask = previousArchitect.currentTask;
    const reviewTask = `Architecture: ${task.title}`;

    setArchitectBusyTaskId(task.id);
    store.setStatus('architect', 'thinking');
    store.setTask('architect', reviewTask);
    store.setSpeech('architect', '시스템 구조 검토 중...');

    try {
      const sessionId = getSessionId();
      const response = await fetch('/api/agents/architect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskTitle: task.title,
          taskDescription: formatDescription(task.description),
          sessionId,
          session_id: sessionId,
        }),
      });
      const result = await response.json() as ArchitectAgentResponse;
      recordAgentResponse({
        agentId: 'architect',
        provider: result.provider,
        traceRecorded: result.traceRecorded ?? false,
        model: result.model ?? null,
        latencyMs: result.latencyMs ?? null,
        inputTokens: result.inputTokens ?? null,
        outputTokens: result.outputTokens ?? null,
      });
      const providerLabel = result.provider === 'claude' ? 'Claude' : 'Mock Architect';
      const summary = result.summary || 'Architect 응답이 비어 있습니다.';
      const architectureNotes = Array.isArray(result.architectureNotes) ? result.architectureNotes : [];
      const speech = `${providerLabel}: ${summary}`.slice(0, 72);

      store.setStatus('architect', 'reviewing');
      store.setSpeech('architect', speech);
      eventBus.emit('agent.message', {
        agentId: 'architect',
        data: {
          message: `설계 검토 완료: ${buildArchitectureSummary({
            ...result,
            summary,
            architectureNotes,
          })}`,
          taskTitle: task.title,
          provider: result.provider,
          nextAgent: result.nextAgent,
        },
      });

      if (architectureNotes.length > 0) {
        eventBus.emit('agent.message', {
          agentId: 'architect',
          data: {
            message: `Architecture notes: ${architectureNotes.slice(0, 3).join(' / ')}`,
            taskTitle: task.title,
            provider: result.provider,
          },
        });
      }

      refreshTraces();
      window.setTimeout(() => {
        if (useSimStore.getState().agents.architect.speech === speech) {
          useSimStore.getState().setSpeech('architect', null);
        }
      }, 4500);
    } catch {
      const speech = 'Architect 호출 실패. Mock simulation은 계속 동작합니다.';
      recordAgentResponse({
        agentId: 'architect',
        provider: 'mock',
        traceRecorded: false,
        model: 'mock-fallback',
        latencyMs: null,
        inputTokens: null,
        outputTokens: null,
      });
      eventBus.emit('agent.message', {
        agentId: 'architect',
        data: {
          message: `설계 검토 완료: ${speech}`,
          taskTitle: task.title,
          provider: 'mock',
        },
      });
      store.setSpeech('architect', speech);
    } finally {
      const architect = useSimStore.getState().agents.architect;
      if (architect.currentTask === reviewTask) {
        useSimStore.getState().setStatus('architect', previousStatus);
        useSimStore.getState().setTask('architect', previousTask);
      }
      setArchitectBusyTaskId(null);
    }
  }

  async function askDeveloper(task: SimTask) {
    if (developerBusyTaskId) return;

    const store = useSimStore.getState();
    const previousDeveloper = store.agents.developer;
    const previousStatus: AgentStatus = previousDeveloper.status;
    const previousTask = previousDeveloper.currentTask;
    const implementationTask = `Implementation: ${task.title}`;

    setDeveloperBusyTaskId(task.id);
    store.setStatus('developer', 'thinking');
    store.setTask('developer', implementationTask);
    store.setSpeech('developer', '구현 방향 정리 중...');

    try {
      const sessionId = getSessionId();
      const response = await fetch('/api/agents/developer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskTitle: task.title,
          taskDescription: formatDescription(task.description),
          sessionId,
          session_id: sessionId,
        }),
      });
      const result = await response.json() as DeveloperAgentResponse;
      recordAgentResponse({
        agentId: 'developer',
        provider: result.provider,
        traceRecorded: result.traceRecorded ?? false,
        model: result.model ?? null,
        latencyMs: result.latencyMs ?? null,
        inputTokens: result.inputTokens ?? null,
        outputTokens: result.outputTokens ?? null,
      });

      const providerLabel = result.provider === 'claude' ? 'Claude' : 'Mock Developer';
      const summary = result.summary || 'Developer 응답이 비어 있습니다.';
      const implementationPlan = Array.isArray(result.implementationPlan) ? result.implementationPlan : [];
      const filesToChange = Array.isArray(result.filesToChange) ? result.filesToChange : [];
      const testPlan = Array.isArray(result.testPlan) ? result.testPlan : [];
      const speech = `${providerLabel}: ${summary}`.slice(0, 72);

      store.setStatus('developer', 'coding');
      store.setSpeech('developer', speech);
      eventBus.emit('agent.message', {
        agentId: 'developer',
        data: {
          message: `구현 계획 완료: ${buildDeveloperSummary({
            ...result,
            summary,
            implementationPlan,
          })}`,
          taskTitle: task.title,
          provider: result.provider,
          nextAgent: result.nextAgent,
        },
      });

      if (filesToChange.length > 0) {
        eventBus.emit('agent.message', {
          agentId: 'developer',
          data: {
            message: `수정 예상 파일: ${filesToChange.slice(0, 4).join(' / ')}`,
            taskTitle: task.title,
            provider: result.provider,
          },
        });
      }

      if (testPlan.length > 0) {
        eventBus.emit('agent.message', {
          agentId: 'developer',
          data: {
            message: `테스트 계획: ${testPlan.slice(0, 3).join(' / ')}`,
            taskTitle: task.title,
            provider: result.provider,
          },
        });
      }

      refreshTraces();
      window.setTimeout(() => {
        if (useSimStore.getState().agents.developer.speech === speech) {
          useSimStore.getState().setSpeech('developer', null);
        }
      }, 4500);
    } catch {
      const speech = 'Developer 호출 실패. Mock simulation은 계속 동작합니다.';
      recordAgentResponse({
        agentId: 'developer',
        provider: 'mock',
        traceRecorded: false,
        model: 'mock-fallback',
        latencyMs: null,
        inputTokens: null,
        outputTokens: null,
      });
      eventBus.emit('agent.message', {
        agentId: 'developer',
        data: {
          message: `구현 계획 완료: ${speech}`,
          taskTitle: task.title,
          provider: 'mock',
        },
      });
      store.setSpeech('developer', speech);
    } finally {
      const developer = useSimStore.getState().agents.developer;
      if (developer.currentTask === implementationTask) {
        useSimStore.getState().setStatus('developer', previousStatus);
        useSimStore.getState().setTask('developer', previousTask);
      }
      setDeveloperBusyTaskId(null);
    }
  }

  async function askReviewer(task: SimTask) {
    if (reviewerBusyTaskId) return;

    const store = useSimStore.getState();
    const previousReviewer = store.agents.reviewer;
    const previousStatus: AgentStatus = previousReviewer.status;
    const previousTask = previousReviewer.currentTask;
    const reviewTask = `Review: ${task.title}`;

    setReviewerBusyTaskId(task.id);
    store.setStatus('reviewer', 'thinking');
    store.setTask('reviewer', reviewTask);
    store.setSpeech('reviewer', '코드 리뷰 검토 중...');

    try {
      const sessionId = getSessionId();
      const response = await fetch('/api/agents/reviewer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskTitle: task.title,
          taskDescription: formatDescription(task.description),
          sessionId,
          session_id: sessionId,
        }),
      });
      const result = await response.json() as ReviewerAgentResponse;
      recordAgentResponse({
        agentId: 'reviewer',
        provider: result.provider,
        traceRecorded: result.traceRecorded ?? false,
        model: result.model ?? null,
        latencyMs: result.latencyMs ?? null,
        inputTokens: result.inputTokens ?? null,
        outputTokens: result.outputTokens ?? null,
      });

      const providerLabel = result.provider === 'claude' ? 'Claude' : 'Mock Reviewer';
      const summary = result.summary || 'Reviewer 응답이 비어 있습니다.';
      const reviewFindings = Array.isArray(result.reviewFindings) ? result.reviewFindings : [];
      const suggestedChanges = Array.isArray(result.suggestedChanges) ? result.suggestedChanges : [];
      const approvalStatus = result.approvalStatus ?? 'needs_more_info';
      const speech = `${providerLabel}: ${summary}`.slice(0, 72);

      store.setStatus('reviewer', 'reviewing');
      store.setSpeech('reviewer', speech);
      eventBus.emit('agent.message', {
        agentId: 'reviewer',
        data: {
          message: `코드 리뷰 완료: ${buildReviewerSummary({
            ...result,
            summary,
            reviewFindings,
          })}`,
          taskTitle: task.title,
          provider: result.provider,
          nextAgent: result.nextAgent,
          approvalStatus,
        },
      });

      if (suggestedChanges.length > 0) {
        eventBus.emit('agent.message', {
          agentId: 'reviewer',
          data: {
            message: `수정 권장사항: ${suggestedChanges.slice(0, 4).join(' / ')}`,
            taskTitle: task.title,
            provider: result.provider,
          },
        });
      }

      eventBus.emit('agent.message', {
        agentId: 'reviewer',
        data: {
          message: `승인 상태: ${approvalStatus}`,
          taskTitle: task.title,
          provider: result.provider,
          nextAgent: result.nextAgent,
        },
      });

      refreshTraces();
      window.setTimeout(() => {
        if (useSimStore.getState().agents.reviewer.speech === speech) {
          useSimStore.getState().setSpeech('reviewer', null);
        }
      }, 4500);
    } catch {
      const speech = 'Reviewer 호출 실패. Mock simulation은 계속 동작합니다.';
      recordAgentResponse({
        agentId: 'reviewer',
        provider: 'mock',
        traceRecorded: false,
        model: 'mock-fallback',
        latencyMs: null,
        inputTokens: null,
        outputTokens: null,
      });
      eventBus.emit('agent.message', {
        agentId: 'reviewer',
        data: {
          message: `코드 리뷰 완료: ${speech}`,
          taskTitle: task.title,
          provider: 'mock',
        },
      });
      store.setSpeech('reviewer', speech);
    } finally {
      const reviewer = useSimStore.getState().agents.reviewer;
      if (reviewer.currentTask === reviewTask) {
        useSimStore.getState().setStatus('reviewer', previousStatus);
        useSimStore.getState().setTask('reviewer', previousTask);
      }
      setReviewerBusyTaskId(null);
    }
  }

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
                  {task.assignedTo === 'architect' && task.status !== 'done' && (
                    <div className="task-card-actions">
                      <button
                        className="task-card-ai-btn task-card-ai-btn--architect"
                        type="button"
                        onClick={() => { void askArchitect(task); }}
                        disabled={architectBusyTaskId !== null}
                        title="Architect Claude/mock으로 시스템 설계 검토"
                      >
                        {architectBusyTaskId === task.id ? 'Reviewing...' : 'Ask Architect'}
                      </button>
                    </div>
                  )}
                  {task.assignedTo === 'developer' && task.status !== 'done' && (
                    <div className="task-card-actions">
                      <button
                        className="task-card-ai-btn task-card-ai-btn--developer"
                        type="button"
                        onClick={() => { void askDeveloper(task); }}
                        disabled={developerBusyTaskId !== null}
                        title="Developer Claude/mock으로 구현 계획 생성"
                      >
                        {developerBusyTaskId === task.id ? 'Planning...' : 'Ask Developer'}
                      </button>
                    </div>
                  )}
                  {task.assignedTo === 'reviewer' && task.status !== 'done' && (
                    <div className="task-card-actions">
                      <button
                        className="task-card-ai-btn task-card-ai-btn--reviewer"
                        type="button"
                        onClick={() => { void askReviewer(task); }}
                        disabled={reviewerBusyTaskId !== null}
                        title="Reviewer Claude/mock으로 코드 리뷰 결과 생성"
                      >
                        {reviewerBusyTaskId === task.id ? 'Reviewing...' : 'Ask Reviewer'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
