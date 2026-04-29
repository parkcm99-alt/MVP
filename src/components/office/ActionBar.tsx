'use client';

import { useState } from 'react';
import { useSimStore } from '@/store/simulationStore';
import { eventBus } from '@/lib/simulation/eventBus';
import { simulationEngine } from '@/lib/simulation/engine';
import type { PlannerAgentResponse } from '@/lib/llm/types';

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

export default function ActionBar() {
  const isRunning = useSimStore(s => s.isRunning);
  const tasks = useSimStore(s => s.tasks);
  const [plannerBusy, setPlannerBusy] = useState(false);

  async function askPlanner() {
    if (plannerBusy) return;

    const task =
      tasks.find(t => t.assignedTo === 'planner' && t.status !== 'done') ??
      tasks.find(t => t.status !== 'done') ??
      tasks[0];
    const taskTitle = task?.title ?? '스프린트 계획 점검';
    const taskDescription = task?.description ?? '현재 MVP의 다음 작업을 안전하게 계획합니다.';
    const pendingSpeech = 'Planner API 테스트 중...';

    setPlannerBusy(true);
    useSimStore.getState().setSpeech('planner', pendingSpeech);

    try {
      const response = await fetch('/api/agents/planner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskTitle, taskDescription }),
      });
      const result = await response.json() as PlannerAgentResponse;
      const providerLabel = result.provider === 'claude' ? 'Claude' : 'Mock Planner';
      const summary = result.summary || 'Planner 응답이 비어 있습니다.';
      const speech = `${providerLabel}: ${summary}`.slice(0, 72);

      eventBus.emit('agent.message', {
        agentId: 'planner',
        data: {
          message: speech,
          taskTitle,
          steps: result.steps,
          risks: result.risks,
          nextAgent: result.nextAgent,
        },
      });

      useSimStore.getState().setSpeech('planner', speech);
      window.setTimeout(() => {
        if (useSimStore.getState().agents.planner.speech === speech) {
          useSimStore.getState().setSpeech('planner', null);
        }
      }, 4500);
    } catch {
      const speech = 'Planner API 테스트 실패. Mock simulation은 계속 동작합니다.';
      eventBus.emit('agent.message', {
        agentId: 'planner',
        data: { message: speech, taskTitle },
      });
      useSimStore.getState().setSpeech('planner', speech);
    } finally {
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
          title="Planner API route 테스트 (기본값은 mock fallback)"
          disabled={plannerBusy}
        >
          {plannerBusy ? 'Asking...' : 'Ask Planner'}
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
