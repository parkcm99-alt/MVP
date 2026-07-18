'use client';

import { eventBus } from '@/lib/simulation/eventBus';
import { getSessionId } from '@/lib/supabase/session';
import { mirrorLlmTrace, recordClientTrace } from '@/lib/debug/clientTraces';
import { useDebugStore } from '@/store/debugStore';
import { useSimStore } from '@/store/simulationStore';
import type { SpecialistAgentResponse, SpecialistRole } from '@/lib/llm/types';
import type { AgentStatus, SimTask, TaskStatus } from '@/types';

const ACTIVE = new Set<string>();
const WORK_STATUS: Record<SpecialistRole, AgentStatus> = {
  architect: 'thinking', developer: 'coding', reviewer: 'reviewing', qa: 'testing',
};
const LABEL: Record<SpecialistRole, string> = {
  architect: 'Architect', developer: 'Developer', reviewer: 'Reviewer', qa: 'QA',
};

function log(role: SpecialistRole, message: string, taskTitle: string) {
  eventBus.emit('agent.message', { agentId: role, data: { message, taskTitle, source: 'ask-agent' } });
}

function lines(value: string[]): string {
  return value.slice(0, 4).join(' · ') || '—';
}

function logResponse(response: SpecialistAgentResponse, taskTitle: string) {
  switch (response.role) {
    case 'architect':
      log('architect', `설계 검토 완료: ${response.summary}`, taskTitle);
      log('architect', `Architecture notes: ${lines(response.architectureNotes)}`, taskTitle);
      log('architect', `Data flow: ${lines(response.dataFlow)}`, taskTitle);
      break;
    case 'developer':
      log('developer', `구현 계획 완료: ${response.summary}`, taskTitle);
      log('developer', `수정 예상 파일: ${lines(response.filesToChange)}`, taskTitle);
      log('developer', `테스트 계획: ${lines(response.testPlan)}`, taskTitle);
      break;
    case 'reviewer':
      log('reviewer', `코드 리뷰 완료: ${response.summary}`, taskTitle);
      log('reviewer', `수정 권장사항: ${lines(response.suggestedChanges)}`, taskTitle);
      log('reviewer', `승인 상태: ${response.approvalStatus}`, taskTitle);
      break;
    case 'qa':
      log('qa', `테스트 계획 완료: ${response.summary}`, taskTitle);
      log('qa', `테스트 케이스: ${lines(response.testCases)}`, taskTitle);
      log('qa', `최종 검증 상태: ${response.finalStatus}`, taskTitle);
      break;
  }
}

function nextTaskStatus(response: SpecialistAgentResponse): TaskStatus {
  if (response.role === 'qa') return response.finalStatus === 'passed' ? 'done' : 'review';
  if (response.role === 'reviewer') return response.approvalStatus === 'approved' ? 'done' : 'review';
  return 'review';
}

/** One safe route call shared by Task Queue and the planner-created Architect workflow. */
export async function askSpecialist(role: SpecialistRole, task: SimTask, manageLifecycle = true): Promise<void> {
  const key = `${role}:${task.id}`;
  if (ACTIVE.has(key)) return;
  ACTIVE.add(key);
  const sessionId = task.sessionId ?? getSessionId();
  const debug = useDebugStore.getState();
  const invocationId = debug.beginInvocation({ sessionId, agentId: role, taskTitle: task.title, startedAt: Date.now() });
  const store = useSimStore.getState();
  const previous = store.agents[role];
  const label = `[ask-agent] ${task.title}`;

  if (manageLifecycle) {
    store.setTask(role, label);
    store.setStatus(role, WORK_STATUS[role]);
    store.setSpeech(role, `${LABEL[role]} 검토 중...`);
    store.updateTask(task.id, { status: 'in_progress' });
    eventBus.emit('task.started', { agentId: role, data: { task: task.title, taskTitle: task.title, source: 'ask-agent' } });
    void recordClientTrace({ sessionId, agentId: role, traceType: 'decision', metadata: {
      task_title: task.title, status: 'in_progress', assigned_to: role,
    } });
  }

  try {
    const response = await fetch(`/api/agents/${role}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskTitle: task.title, taskDescription: task.description, sessionId }),
    });
    const result: unknown = await response.json();
    if (!result || typeof result !== 'object' || (result as { role?: unknown }).role !== role) throw new Error('invalid_response');
    const value = result as SpecialistAgentResponse;
    const traceRecorded = value.traceRecorded ?? false;
    useDebugStore.getState().recordAgentResponse({
      role, provider: value.provider, traceRecorded, model: value.model,
      latencyMs: value.latencyMs, inputTokens: value.inputTokens, outputTokens: value.outputTokens,
    });
    useDebugStore.getState().completeInvocation(invocationId, value.provider, traceRecorded);
    const outcome = value.role === 'reviewer' ? { approvalStatus: value.approvalStatus }
      : value.role === 'qa' ? { finalStatus: value.finalStatus } : {};
    mirrorLlmTrace({
      sessionId, agentId: role, inputTokens: value.inputTokens, outputTokens: value.outputTokens,
      latencyMs: value.latencyMs, model: value.model,
      metadata: { task_title: task.title, provider: value.provider, traceRecorded, local_only: true, ...outcome },
    });
    logResponse(value, task.title);
    store.setSpeech(role, value.summary.slice(0, 72));
    if (manageLifecycle) {
      const status = nextTaskStatus(value);
      store.updateTask(task.id, { status });
      if (status === 'done') {
        store.bumpCompleted(role);
        eventBus.emit('task.completed', { agentId: role, data: { task: task.title, taskTitle: task.title, source: 'ask-agent' } });
      }
    }
    window.setTimeout(() => {
      if (useSimStore.getState().agents[role].speech === value.summary.slice(0, 72)) useSimStore.getState().setSpeech(role, null);
    }, 4500);
  } catch {
    useDebugStore.getState().completeInvocation(invocationId, null, false);
    useDebugStore.getState().recordAgentResponse({ role, provider: 'mock', traceRecorded: false, model: 'mock-fallback' });
    log(role, '호출 실패. Mock simulation은 계속 동작합니다.', task.title);
    store.setSpeech(role, '호출 실패 · mock 유지');
    if (manageLifecycle) store.updateTask(task.id, { status: task.status });
  } finally {
    if (manageLifecycle && useSimStore.getState().agents[role].currentTask === label) {
      store.setStatus(role, previous.status);
      store.setTask(role, previous.currentTask);
    }
    ACTIVE.delete(key);
  }
}
