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
import type {
  ArchitectAgentResponse,
  DeveloperAgentResponse,
  LlmProvider,
  PlannerAgentResponse,
  QaAgentResponse,
  ReviewerAgentResponse,
} from '@/lib/llm/types';

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

// ── Full-flow helpers ─────────────────────────────────────────────────────────

interface FlowDebugUpdate {
  agentId: AgentRole;
  provider: LlmProvider;
  traceRecorded?: boolean | null;
  model?: string | null;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
}

function buildContext(summary: string, lines: string[]): string {
  const body = lines.slice(0, 5).join(' | ');
  return `이전 단계 요약: ${summary}${body ? ` | 세부: ${body}` : ''}`.slice(0, 700);
}

export default function ActionBar() {
  const isRunning = useSimStore(s => s.isRunning);
  const tasks = useSimStore(s => s.tasks);
  const [plannerBusy, setPlannerBusy] = useState(false);
  const [flowBusy, setFlowBusy] = useState(false);
  const recordPlannerResponse = useDebugStore(s => s.recordPlannerResponse);
  const recordAgentResponse = useDebugStore(s => s.recordAgentResponse);
  const setLastFlowSummary = useDebugStore(s => s.setLastFlowSummary);
  const generatedPlannerResponses = useRef<Set<string>>(new Set());
  const plannerWorkflowTimers = useRef<BrowserTimer[]>([]);

  useEffect(() => () => {
    plannerWorkflowTimers.current.forEach(window.clearTimeout);
    plannerWorkflowTimers.current = [];
  }, []);

  async function runFullFlow() {
    if (plannerBusy || flowBusy) return;

    const task = pickHighestPriorityTask(tasks);
    const baseTitle = task?.title ?? 'Full Agent Flow 태스크';
    const baseDesc  = task?.description ?? '전체 AI Agent 워크플로우를 실행합니다.';
    const sessionId = getSessionId();

    function sysLog(msg: string) {
      useSimStore.getState().addEvent({ agentId: 'planner', agentName: 'System', agentColor: '#D97706', type: 'system', message: msg });
    }

    function recordStep(u: FlowDebugUpdate) {
      recordAgentResponse({
        agentId:      u.agentId,
        provider:     u.provider,
        traceRecorded: u.traceRecorded ?? null,
        model:        u.model ?? null,
        latencyMs:    u.latencyMs ?? null,
        inputTokens:  u.inputTokens ?? null,
        outputTokens: u.outputTokens ?? null,
      });
    }

    setFlowBusy(true);
    sysLog('[FLOW] Full Agent Flow 시작');

    let totalInputTokens  = 0;
    let totalOutputTokens = 0;
    let totalLatencyMs    = 0;

    try {
      // ── Step 1: Planner ──────────────────────────────────────────────────
      useSimStore.getState().setStatus('planner', 'thinking');
      useSimStore.getState().setSpeech('planner', 'Full Flow 계획 중...');
      let plannerResult: PlannerAgentResponse;
      try {
        const res = await fetch('/api/agents/planner', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskTitle: baseTitle, taskDescription: baseDesc, sessionId, session_id: sessionId }),
        });
        plannerResult = await res.json() as PlannerAgentResponse;
      } catch {
        sysLog('[FLOW] [Planner] 호출 실패 — Flow 중단');
        return;
      }
      recordStep({ agentId: 'planner', provider: plannerResult.provider, traceRecorded: plannerResult.traceRecorded, model: plannerResult.model, latencyMs: plannerResult.latencyMs, inputTokens: plannerResult.inputTokens, outputTokens: plannerResult.outputTokens });
      totalInputTokens  += plannerResult.inputTokens  ?? 0;
      totalOutputTokens += plannerResult.outputTokens ?? 0;
      totalLatencyMs    += plannerResult.latencyMs    ?? 0;
      const plannerSummary = plannerResult.summary || '(no summary)';
      sysLog(`[Planner] 계획 완료: ${plannerSummary}`);
      useSimStore.getState().setSpeech('planner', plannerSummary.slice(0, 72));
      eventBus.emit('agent.planning', {
        agentId: 'planner',
        data: { summary: plannerSummary, steps: plannerResult.steps ?? [], taskTitle: baseTitle, taskPriority: task?.priority ?? 'medium', provider: plannerResult.provider, risks: plannerResult.risks, nextAgent: plannerResult.nextAgent },
      });

      // ── Step 2: Architect ────────────────────────────────────────────────
      useSimStore.getState().setStatus('architect', 'thinking');
      useSimStore.getState().setSpeech('architect', '설계 검토 중...');
      let architectResult: ArchitectAgentResponse;
      try {
        const res = await fetch('/api/agents/architect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskTitle: baseTitle, taskDescription: buildContext(plannerSummary, plannerResult.steps ?? []), sessionId, session_id: sessionId }),
        });
        architectResult = await res.json() as ArchitectAgentResponse;
      } catch {
        sysLog('[FLOW] [Architect] 호출 실패 — Flow 중단');
        return;
      }
      recordStep({ agentId: 'architect', provider: architectResult.provider, traceRecorded: architectResult.traceRecorded, model: architectResult.model, latencyMs: architectResult.latencyMs, inputTokens: architectResult.inputTokens, outputTokens: architectResult.outputTokens });
      totalInputTokens  += architectResult.inputTokens  ?? 0;
      totalOutputTokens += architectResult.outputTokens ?? 0;
      totalLatencyMs    += architectResult.latencyMs    ?? 0;
      const architectSummary = architectResult.summary || '(no summary)';
      sysLog(`[Architect] 설계 검토 완료: ${architectSummary}`);
      useSimStore.getState().setSpeech('architect', architectSummary.slice(0, 72));
      eventBus.emit('agent.message', { agentId: 'architect', data: { message: architectSummary, taskTitle: baseTitle, provider: architectResult.provider } });

      // ── Step 3: Developer ────────────────────────────────────────────────
      useSimStore.getState().setStatus('developer', 'coding');
      useSimStore.getState().setSpeech('developer', '구현 계획 작성 중...');
      let developerResult: DeveloperAgentResponse;
      try {
        const res = await fetch('/api/agents/developer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskTitle: baseTitle, taskDescription: buildContext(architectSummary, architectResult.architectureNotes ?? []), sessionId, session_id: sessionId }),
        });
        developerResult = await res.json() as DeveloperAgentResponse;
      } catch {
        sysLog('[FLOW] [Developer] 호출 실패 — Flow 중단');
        return;
      }
      recordStep({ agentId: 'developer', provider: developerResult.provider, traceRecorded: developerResult.traceRecorded, model: developerResult.model, latencyMs: developerResult.latencyMs, inputTokens: developerResult.inputTokens, outputTokens: developerResult.outputTokens });
      totalInputTokens  += developerResult.inputTokens  ?? 0;
      totalOutputTokens += developerResult.outputTokens ?? 0;
      totalLatencyMs    += developerResult.latencyMs    ?? 0;
      const developerSummary = developerResult.summary || '(no summary)';
      sysLog(`[Developer] 구현 계획 완료: ${developerSummary}`);
      useSimStore.getState().setSpeech('developer', developerSummary.slice(0, 72));
      eventBus.emit('agent.message', { agentId: 'developer', data: { message: developerSummary, taskTitle: baseTitle, provider: developerResult.provider } });

      // ── Step 4: Reviewer ─────────────────────────────────────────────────
      useSimStore.getState().setStatus('reviewer', 'reviewing');
      useSimStore.getState().setSpeech('reviewer', '코드 리뷰 중...');
      let reviewerResult: ReviewerAgentResponse;
      try {
        const res = await fetch('/api/agents/reviewer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskTitle: baseTitle, taskDescription: buildContext(developerSummary, developerResult.implementationPlan ?? []), sessionId, session_id: sessionId }),
        });
        reviewerResult = await res.json() as ReviewerAgentResponse;
      } catch {
        sysLog('[FLOW] [Reviewer] 호출 실패 — Flow 중단');
        return;
      }
      recordStep({ agentId: 'reviewer', provider: reviewerResult.provider, traceRecorded: reviewerResult.traceRecorded, model: reviewerResult.model, latencyMs: reviewerResult.latencyMs, inputTokens: reviewerResult.inputTokens, outputTokens: reviewerResult.outputTokens });
      totalInputTokens  += reviewerResult.inputTokens  ?? 0;
      totalOutputTokens += reviewerResult.outputTokens ?? 0;
      totalLatencyMs    += reviewerResult.latencyMs    ?? 0;
      const reviewerSummary = reviewerResult.summary || '(no summary)';
      sysLog(`[Reviewer] 리뷰 완료 (${reviewerResult.approvalStatus}): ${reviewerSummary}`);
      useSimStore.getState().setSpeech('reviewer', reviewerSummary.slice(0, 72));
      eventBus.emit('agent.message', { agentId: 'reviewer', data: { message: reviewerSummary, taskTitle: baseTitle, provider: reviewerResult.provider } });

      // ── Step 5: QA ───────────────────────────────────────────────────────
      useSimStore.getState().setStatus('qa', 'testing');
      useSimStore.getState().setSpeech('qa', 'QA 검증 중...');
      let qaResult: QaAgentResponse;
      try {
        const res = await fetch('/api/agents/qa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskTitle: baseTitle, taskDescription: buildContext(reviewerSummary, reviewerResult.reviewFindings ?? []), sessionId, session_id: sessionId }),
        });
        qaResult = await res.json() as QaAgentResponse;
      } catch {
        sysLog('[FLOW] [QA] 호출 실패 — Flow 중단');
        return;
      }
      recordStep({ agentId: 'qa', provider: qaResult.provider, traceRecorded: qaResult.traceRecorded, model: qaResult.model, latencyMs: qaResult.latencyMs, inputTokens: qaResult.inputTokens, outputTokens: qaResult.outputTokens });
      totalInputTokens  += qaResult.inputTokens  ?? 0;
      totalOutputTokens += qaResult.outputTokens ?? 0;
      totalLatencyMs    += qaResult.latencyMs    ?? 0;
      const qaSummary = qaResult.summary || '(no summary)';
      sysLog(`[QA] 검증 완료 (${qaResult.finalStatus}): ${qaSummary}`);
      useSimStore.getState().setSpeech('qa', qaSummary.slice(0, 72));
      eventBus.emit('agent.message', { agentId: 'qa', data: { message: qaSummary, taskTitle: baseTitle, provider: qaResult.provider } });

      // ── Flow complete ────────────────────────────────────────────────────
      const flowSummary = `Full Flow 완료 | 총 ${totalInputTokens + totalOutputTokens} tokens | ${totalLatencyMs}ms | ${qaResult.finalStatus}`;
      setLastFlowSummary(flowSummary);
      sysLog(`[FLOW] ${flowSummary}`);
    } finally {
      // Restore agent states
      (['planner', 'architect', 'developer', 'reviewer', 'qa'] as AgentRole[]).forEach(id => {
        const store = useSimStore.getState();
        if (store.agents[id].status !== 'idle') {
          store.setStatus(id, 'idle');
          store.setTask(id, null);
        }
      });
      setFlowBusy(false);
    }
  }

  async function askPlanner() {
    if (plannerBusy || flowBusy) return;

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
      const response = await fetch('/api/agents/planner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskTitle, taskDescription, sessionId, session_id: sessionId }),
      });
      const result = await response.json() as PlannerAgentResponse;
      recordPlannerResponse({
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
          disabled={plannerBusy || flowBusy}
        >
          {plannerBusy ? 'Planning...' : 'Plan with Claude'}
        </ActionBtn>
        <ActionBtn
          variant="flow"
          onClick={() => { void runFullFlow(); }}
          title="Planner → Architect → Developer → Reviewer → QA 전체 워크플로우 실행"
          disabled={flowBusy || plannerBusy}
        >
          {flowBusy ? 'Running Flow...' : '⚡ Run Full Flow'}
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
