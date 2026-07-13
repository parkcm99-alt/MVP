'use client';

import { type MutableRefObject, useEffect, useRef, useState } from 'react';
import { useSimStore } from '@/store/simulationStore';
import { assignPlannerStep } from '@/lib/agents/plannerStepAssignment';
import { eventBus } from '@/lib/simulation/eventBus';
import { simulationEngine } from '@/lib/simulation/engine';
import { DESK_STAND } from '@/lib/simulation/config';
import { getSessionId } from '@/lib/supabase/session';
import { insertAgentTrace } from '@/lib/supabase/traces';
import { useDebugStore } from '@/store/debugStore';
import type { AgentRole, AgentStatus, SimTask, TaskPriority, TaskStatus } from '@/types';
import type { PlannerAgentResponse } from '@/lib/llm/types';
import { appendLocalTrace } from '@/lib/debug/traceCorrelation';

interface ActionBtnProps {
  variant: string;
  onClick: () => void;
  title: string;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}

function ActionBtn({ variant, onClick, title, active, disabled, children }: ActionBtnProps) {
  return (
    <button
      className={`action-btn action-btn-${variant}${active ? ' action-btn--active' : ''}`}
      onClick={onClick}
      title={title}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

const PRIORITY_SCORE: Record<TaskPriority, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const STATUS_SCORE: Record<TaskStatus, number> = {
  in_progress: 3,
  review: 2,
  backlog: 1,
  done: 0,
};

const PLANNER_GENERATED_MARKER = '[planner-generated]';
type BrowserTimer = number;

const PLANNER_WORK_STATUS: Record<AgentRole, AgentStatus> = {
  planner: 'thinking',
  architect: 'thinking',
  developer: 'coding',
  reviewer: 'reviewing',
  qa: 'testing',
};

function pickHighestPriorityTask(tasks: SimTask[]): SimTask | undefined {
  return tasks
    .filter(task => task.status !== 'done')
    .sort((a, b) => {
      const priorityDiff = PRIORITY_SCORE[b.priority] - PRIORITY_SCORE[a.priority];
      if (priorityDiff !== 0) return priorityDiff;

      const statusDiff = STATUS_SCORE[b.status] - STATUS_SCORE[a.status];
      if (statusDiff !== 0) return statusDiff;

      return a.createdAt - b.createdAt;
    })[0] ?? tasks[0];
}

function buildStepSummary(steps: string[]): string {
  if (steps.length === 0) return '다음 단계가 비어 있습니다.';
  return steps.map((step, index) => `${index + 1}. ${step}`).join(' ');
}

function list(value: unknown): string {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string').join(' · ') : '—';
}

function normalizeFingerprintPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildPlannerResponseFingerprint(taskTitle: string, summary: string, steps: string[]): string {
  return [
    normalizeFingerprintPart(taskTitle),
    normalizeFingerprintPart(summary),
    ...steps.map(normalizeFingerprintPart),
  ].join('|');
}

function createTasksFromPlannerSteps(
  responseFingerprint: string,
  sourceTaskTitle: string,
  sourcePriority: TaskPriority,
  steps: string[],
  generatedFingerprints: Set<string>,
): SimTask[] {
  if (generatedFingerprints.has(responseFingerprint)) return [];

  const cleanSteps = steps
    .map(step => step.trim())
    .filter(Boolean)
    .slice(0, 6);

  if (cleanSteps.length === 0) return [];

  const store = useSimStore.getState();
  const createdTasks = cleanSteps.flatMap((step, index) =>
    assignPlannerStep(step).map(spec =>
      store.addTask({
        title: spec.title,
        description: `${PLANNER_GENERATED_MARKER} source="${sourceTaskTitle}" response="${responseFingerprint.slice(0, 12)}" step=${index + 1} original="${spec.originalStep}"`,
        assignedTo: spec.assignedTo,
        status: 'backlog',
        priority: sourcePriority,
      }),
    ),
  );

  createdTasks.forEach(task => {
    void insertAgentTrace({
      agentId: 'planner',
      traceType: 'handoff',
      metadata: {
        source_agent: 'planner',
        target_agent: task.assignedTo ?? 'planner',
        task_title: task.title,
      },
    });
  });

  generatedFingerprints.add(responseFingerprint);
  return createdTasks;
}

function schedulePlannerGeneratedWorkflow(
  tasks: SimTask[],
  timers: MutableRefObject<BrowserTimer[]>,
) {
  tasks.forEach((task, index) => {
    const agentId = task.assignedTo ?? 'planner';
    const taskLabel = `${PLANNER_GENERATED_MARKER} ${task.title}`;
    const startDelay = index * 900;
    const workDelay = startDelay + 450;
    const doneDelay = startDelay + 6200;
    const clearSpeechDelay = doneDelay + 1800;
    let previousStatus: AgentStatus | null = null;
    let previousTask: string | null = null;
    let previousX: number | null = null;
    let previousY: number | null = null;

    timers.current.push(window.setTimeout(() => {
      const store = useSimStore.getState();
      if (store.tasks.find(t => t.id === task.id)?.status === 'done') return;
      const previousAgent = store.agents[agentId];
      previousStatus = previousAgent.status;
      previousTask = previousAgent.currentTask;
      previousX = previousAgent.position.x;
      previousY = previousAgent.position.y;

      store.setTask(agentId, taskLabel);
      store.setStatus(agentId, 'walking');
      store.moveAgent(agentId, DESK_STAND[agentId]);
      store.setSpeech(agentId, `태스크 시작: ${task.title}`.slice(0, 64));
      eventBus.emit('agent.moved', {
        agentId,
        data: { source: 'planner-generated', taskId: task.id },
      });
      eventBus.emit('task.started', {
        agentId,
        data: { task: task.title, taskId: task.id, source: 'planner-generated' },
      });
      void insertAgentTrace({
        agentId,
        traceType: 'decision',
        metadata: {
          task_title: task.title,
          status: 'in_progress',
          assigned_to: agentId,
        },
      });
      store.updateTask(task.id, { status: 'in_progress' });
    }, startDelay));

    timers.current.push(window.setTimeout(() => {
      const store = useSimStore.getState();
      if (store.agents[agentId].currentTask !== taskLabel) return;
      store.setStatus(agentId, PLANNER_WORK_STATUS[agentId]);
    }, workDelay));

    timers.current.push(window.setTimeout(() => {
      const store = useSimStore.getState();
      const currentTask = store.tasks.find(t => t.id === task.id);
      if (!currentTask || currentTask.status === 'done') return;

      store.updateTask(task.id, { status: 'done' });
      store.bumpCompleted(agentId);
      eventBus.emit('task.completed', {
        agentId,
        data: { task: task.title, taskId: task.id, source: 'planner-generated' },
      });

      if (store.agents[agentId].currentTask === taskLabel) {
        store.setSpeech(agentId, `완료: ${task.title}`.slice(0, 64));
        store.setStatus(agentId, previousStatus ?? 'idle');
        store.setTask(agentId, previousTask);
        if (previousX !== null && previousY !== null) {
          store.moveAgent(agentId, { x: previousX, y: previousY });
        }
      }
    }, doneDelay));

    timers.current.push(window.setTimeout(() => {
      const store = useSimStore.getState();
      if (store.agents[agentId].speech?.startsWith('완료:')) {
        store.setSpeech(agentId, null);
      }
    }, clearSpeechDelay));
  });
}

export default function ActionBar() {
  const isRunning = useSimStore(s => s.isRunning);
  const tasks = useSimStore(s => s.tasks);
  const [plannerBusy, setPlannerBusy] = useState(false);
  const [agentBusy, setAgentBusy] = useState<AgentRole | null>(null);
  const recordPlannerResponse = useDebugStore(s => s.recordPlannerResponse);
  const generatedPlannerResponses = useRef<Set<string>>(new Set());
  const plannerWorkflowTimers = useRef<BrowserTimer[]>([]);

  useEffect(() => () => {
    plannerWorkflowTimers.current.forEach(window.clearTimeout);
    plannerWorkflowTimers.current = [];
  }, []);

  async function askPlanner() {
    if (plannerBusy) return;

    const task = pickHighestPriorityTask(tasks);
    const taskTitle = task?.title ?? '스프린트 계획 점검';
    const taskDescription = task?.description ?? '현재 MVP의 다음 작업을 안전하게 계획합니다.';
    const planningTask = `Planning: ${taskTitle}`;
    const pendingSpeech = '우선순위 태스크 계획 중...';
    const previousPlanner = useSimStore.getState().agents.planner;
    const previousStatus: AgentStatus = previousPlanner.status;
    const previousTask = previousPlanner.currentTask;

    setPlannerBusy(true);
    useSimStore.getState().setStatus('planner', 'thinking');
    useSimStore.getState().setTask('planner', planningTask);
    useSimStore.getState().setSpeech('planner', pendingSpeech);

    try {
      const sessionId = getSessionId();
      appendLocalTrace({ session_id: sessionId, agent_id: 'planner', trace_type: 'tool_use', metadata: { action: 'ask_agent', task_title: taskTitle } });
      const response = await fetch('/api/agents/planner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskTitle, taskDescription, sessionId, session_id: sessionId }),
      });
      const result = await response.json() as PlannerAgentResponse;
      appendLocalTrace({ session_id: sessionId, agent_id: 'planner', trace_type: 'llm_call', latency_ms: result.latencyMs ?? null, model: result.model ?? null, metadata: { task_title: taskTitle, traceRecorded: result.traceRecorded ?? false } });
      recordPlannerResponse({
        role: 'planner',
        provider: result.provider,
        traceRecorded: result.traceRecorded ?? false,
        model: result.model ?? null,
        latencyMs: result.latencyMs ?? null,
        inputTokens: result.inputTokens ?? null,
        outputTokens: result.outputTokens ?? null,
      });
      const providerLabel = result.provider === 'claude' ? 'Claude' : 'Mock Planner';
      const summary = result.summary || 'Planner 응답이 비어 있습니다.';
      const steps = Array.isArray(result.steps) ? result.steps : [];
      const speech = `${providerLabel}: ${summary}`.slice(0, 72);
      const sourcePriority = task?.priority ?? 'medium';
      const responseFingerprint = buildPlannerResponseFingerprint(taskTitle, summary, steps);
      const createdTasks = createTasksFromPlannerSteps(
        responseFingerprint,
        taskTitle,
        sourcePriority,
        steps,
        generatedPlannerResponses.current,
      );
      const createdTaskCount = createdTasks.length;

      schedulePlannerGeneratedWorkflow(createdTasks, plannerWorkflowTimers);

      eventBus.emit('agent.planning', {
        agentId: 'planner',
        data: {
          summary,
          steps,
          taskTitle,
          taskPriority: sourcePriority,
          provider: result.provider,
          risks: result.risks,
          nextAgent: result.nextAgent,
        },
      });
      eventBus.emit('agent.message', {
        agentId: 'planner',
        data: {
          message: `Steps: ${buildStepSummary(steps)}`,
          taskTitle,
          provider: result.provider,
        },
      });
      eventBus.emit('agent.message', {
        agentId: 'planner',
        data: {
          message: `Planner가 ${createdTaskCount}개의 하위 작업을 생성했습니다`,
          taskTitle,
          generatedTaskCount: createdTaskCount,
          provider: result.provider,
        },
      });

      useSimStore.getState().setSpeech('planner', speech);
      window.setTimeout(() => {
        if (useSimStore.getState().agents.planner.speech === speech) {
          useSimStore.getState().setSpeech('planner', null);
        }
      }, 4500);
    } catch {
      const speech = 'Planner 호출 실패. Mock simulation은 계속 동작합니다.';
      recordPlannerResponse({
        role: 'planner',
        provider: 'mock',
        traceRecorded: false,
        model: 'mock-fallback',
        latencyMs: null,
        inputTokens: null,
        outputTokens: null,
      });
      eventBus.emit('agent.planning', {
        agentId: 'planner',
        data: {
          summary: speech,
          steps: ['기존 mock simulation 흐름을 유지합니다.'],
          taskTitle,
          provider: 'mock',
        },
      });
      useSimStore.getState().setSpeech('planner', speech);
    } finally {
      const planner = useSimStore.getState().agents.planner;
      if (planner.currentTask === planningTask) {
        useSimStore.getState().setStatus('planner', previousStatus);
        useSimStore.getState().setTask('planner', previousTask);
      }
      setPlannerBusy(false);
    }
  }

  async function askSpecialist(role: Exclude<AgentRole, 'planner'>) {
    if (agentBusy) return;
    const task = tasks.find(item => item.assignedTo === role && item.status !== 'done')
      ?? pickHighestPriorityTask(tasks);
    const taskTitle = task?.title ?? `${role} 검토`;
    const taskDescription = task?.description ?? '현재 MVP 작업을 검토하고 다음 단계를 제안합니다.';
    const previous = useSimStore.getState().agents[role];
    setAgentBusy(role);
    useSimStore.getState().setStatus(role, PLANNER_WORK_STATUS[role]);
    useSimStore.getState().setTask(role, taskTitle);
    useSimStore.getState().setSpeech(role, 'Claude/mock 응답 대기 중...');
    try {
      const sessionId = getSessionId();
      appendLocalTrace({ session_id: sessionId, agent_id: role, trace_type: 'tool_use', metadata: { action: 'ask_agent', task_title: taskTitle } });
      const response = await fetch(`/api/agents/${role}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskTitle, taskDescription, sessionId }),
      });
      const result = await response.json() as Record<string, unknown>;
      appendLocalTrace({ session_id: sessionId, agent_id: role, trace_type: 'llm_call', latency_ms: typeof result.latencyMs === 'number' ? result.latencyMs : null, model: typeof result.model === 'string' ? result.model : null, metadata: { task_title: taskTitle, traceRecorded: result.traceRecorded === true, finalStatus: result.finalStatus, approvalStatus: result.approvalStatus } });
      const provider = result.provider === 'claude' ? 'claude' : 'mock';
      const summary = typeof result.summary === 'string' ? result.summary : '응답이 비어 있습니다.';
      recordPlannerResponse({ role, provider, traceRecorded: result.traceRecorded === true,
        model: typeof result.model === 'string' ? result.model : null,
        latencyMs: typeof result.latencyMs === 'number' ? result.latencyMs : null,
        inputTokens: typeof result.inputTokens === 'number' ? result.inputTokens : null,
        outputTokens: typeof result.outputTokens === 'number' ? result.outputTokens : null });
      const lines: Record<string, [string, string][]> = {
        architect: [['설계 검토 완료', summary], ['아키텍처 노트', list(result.architectureNotes)]],
        developer: [['구현 계획 완료', summary], ['수정 예상 파일', list(result.filesToChange)], ['테스트 계획', list(result.testPlan)]],
        reviewer: [['코드 리뷰 완료', summary], ['수정 권장사항', list(result.suggestedChanges)], ['승인 상태', String(result.approvalStatus ?? '—')]],
        qa: [['테스트 계획 완료', summary], ['테스트 케이스', list(result.testCases)], ['최종 검증 상태', String(result.finalStatus ?? '—')]],
      };
      lines[role].forEach(([label, value]) => eventBus.emit('agent.message', {
        agentId: role, data: { message: `[${previous.name}] ${label}: ${value}` },
      }));
      useSimStore.getState().setSpeech(role, summary.slice(0, 72));
      window.setTimeout(() => useSimStore.getState().setSpeech(role, null), 4500);
    } catch {
      eventBus.emit('agent.message', { agentId: role, data: { message: '호출 실패. mock simulation은 계속 동작합니다.' } });
    } finally {
      useSimStore.getState().setStatus(role, previous.status);
      useSimStore.getState().setTask(role, previous.currentTask);
      setAgentBusy(null);
    }
  }

  return (
    <div className="action-bar">
      <span className="action-bar-label">ACTIONS</span>
      <div className="action-bar-buttons">
        <ActionBtn
          variant="start"
          onClick={() => simulationEngine.startSprint()}
          title="새 스프린트 시작"
          active={isRunning}
        >
          ▶ Start Sprint
        </ActionBtn>
        {(['architect', 'developer', 'reviewer', 'qa'] as const).map(role => (
          <ActionBtn key={role} variant="planner" onClick={() => { void askSpecialist(role); }}
            title={`${role} 담당 태스크를 Claude/mock으로 검토`} disabled={agentBusy !== null}>
            {agentBusy === role ? `${role}...` : `Ask ${role[0].toUpperCase()}${role.slice(1)}`}
          </ActionBtn>
        ))}
        <ActionBtn
          variant="meeting"
          onClick={() => simulationEngine.callMeeting()}
          title="전체 미팅 소집"
        >
          💬 Call Meeting
        </ActionBtn>
        <ActionBtn
          variant="task"
          onClick={() => simulationEngine.createMockTask()}
          title="랜덤 태스크 추가"
        >
          + Add Task
        </ActionBtn>
        <ActionBtn
          variant="planner"
          onClick={() => { void askPlanner(); }}
          title="가장 우선순위 높은 태스크를 Planner Claude/mock으로 계획"
          disabled={plannerBusy}
        >
          {plannerBusy ? 'Planning...' : 'Plan with Claude'}
        </ActionBtn>
        <ActionBtn
          variant="complete"
          onClick={() => simulationEngine.completeSprint()}
          title="스프린트 즉시 완료"
        >
          ✓ Complete
        </ActionBtn>
        <ActionBtn
          variant="reset"
          onClick={() => simulationEngine.resetOffice()}
          title="오피스 초기화"
        >
          ↺ Reset
        </ActionBtn>
      </div>
    </div>
  );
}
