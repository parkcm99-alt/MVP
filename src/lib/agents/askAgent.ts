import { recordClientTrace } from '@/lib/debug/clientTraces';
import { eventBus } from '@/lib/simulation/eventBus';
import { getSessionId, uuid } from '@/lib/supabase/session';
import { useDebugStore } from '@/store/debugStore';
import { useSimStore } from '@/store/simulationStore';
import type { SpecialistAgentResponse, SpecialistAgentRole } from '@/lib/llm/types';
import type { AgentStatus, SimTask } from '@/types';

const WORK_STATUS: Record<SpecialistAgentRole, AgentStatus> = {
  architect: 'thinking', developer: 'coding', reviewer: 'reviewing', qa: 'testing',
};

function emit(role: SpecialistAgentRole, message: string, task: SimTask, extra: Record<string, unknown> = {}) {
  eventBus.emit('agent.message', {
    agentId: role,
    data: { message, taskTitle: task.title, taskId: task.id, ...extra },
  });
}

function shortList(items: string[]): string {
  return items.slice(0, 3).join(' · ').slice(0, 420) || '—';
}

function logResult(result: SpecialistAgentResponse, task: SimTask) {
  switch (result.role) {
    case 'architect':
      emit('architect', `설계 검토 완료: ${result.summary}`, task, { architectureNotes: result.architectureNotes });
      emit('architect', `설계 노트: ${shortList(result.architectureNotes)}`, task);
      break;
    case 'developer':
      emit('developer', `구현 계획 완료: ${result.summary}`, task);
      emit('developer', `수정 예상 파일: ${shortList(result.filesToChange)}`, task);
      emit('developer', `테스트 계획: ${shortList(result.testPlan)}`, task);
      break;
    case 'reviewer':
      emit('reviewer', `코드 리뷰 완료: ${result.summary}`, task);
      emit('reviewer', `수정 권장사항: ${shortList(result.suggestedChanges)}`, task);
      emit('reviewer', `승인 상태: ${result.approvalStatus}`, task, { approvalStatus: result.approvalStatus });
      break;
    case 'qa':
      emit('qa', `테스트 계획 완료: ${result.summary}`, task);
      emit('qa', `테스트 케이스: ${shortList(result.testCases)}`, task);
      emit('qa', `최종 검증 상태: ${result.finalStatus}`, task, { finalStatus: result.finalStatus });
      break;
  }
}

/** Manual, cost-gated specialist request. The server is the only live Claude caller. */
export async function askSpecialistAgent(role: SpecialistAgentRole, task: SimTask): Promise<void> {
  const sessionId = getSessionId();
  const callId = uuid();
  const store = useSimStore.getState();
  const previous = store.agents[role];
  const activeTask = `[ask-agent] ${task.title}`;
  useDebugStore.getState().startAgentCall({ id: callId, sessionId, agentId: role, taskTitle: task.title, calledAt: Date.now() });
  store.setStatus(role, WORK_STATUS[role]);
  store.setTask(role, activeTask);
  store.setSpeech(role, `${task.title} 검토 중...`.slice(0, 64));

  try {
    const response = await fetch(`/api/agents/${role}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskTitle: task.title, taskDescription: task.description, sessionId, traceId: callId }),
    });
    const result = await response.json() as SpecialistAgentResponse;
    if (!response.ok || result.role !== role || (result.provider !== 'mock' && result.provider !== 'claude')) throw new Error('invalid_response');

    const telemetry = {
      provider: result.provider,
      traceRecorded: result.traceRecorded ?? false,
      model: result.model ?? null,
      latencyMs: result.latencyMs ?? null,
      inputTokens: result.inputTokens ?? null,
      outputTokens: result.outputTokens ?? null,
    };
    useDebugStore.getState().recordAgentResponse(callId, role, telemetry);
    recordClientTrace({
      id: callId, sessionId, agentId: role, traceType: 'llm_call',
      ...telemetry,
      metadata: {
        provider: result.provider, task_title: task.title, traceRecorded: telemetry.traceRecorded,
        ...('approvalStatus' in result ? { approvalStatus: result.approvalStatus } : {}),
        ...('finalStatus' in result ? { finalStatus: result.finalStatus } : {}),
      },
      // Live routes await their insert; mock traces stay local-only.
      persist: false,
    });
    logResult(result, task);
    const speech = `${result.provider === 'claude' ? 'Claude' : 'Mock'}: ${result.summary}`.slice(0, 72);
    useSimStore.getState().setSpeech(role, speech);
    window.setTimeout(() => {
      if (useSimStore.getState().agents[role].speech === speech) useSimStore.getState().setSpeech(role, null);
    }, 5000);
  } catch {
    useDebugStore.getState().recordAgentResponse(callId, role, {
      provider: 'mock', traceRecorded: false, model: 'request-failed', failed: true,
    });
    emit(role, '요청 실패. Mock simulation은 계속 동작합니다.', task);
    useSimStore.getState().setSpeech(role, '요청 실패 · mock simulation 유지');
  } finally {
    const current = useSimStore.getState().agents[role];
    if (current.currentTask === activeTask) {
      useSimStore.getState().setStatus(role, previous.status);
      useSimStore.getState().setTask(role, previous.currentTask);
    }
  }
}
