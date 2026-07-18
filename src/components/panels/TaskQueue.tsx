'use client';

import { useState } from 'react';
import HighlightedText from '@/components/debug/HighlightedText';
import { mergeTraces } from '@/lib/debug/correlation';
import { filterTasks, getTraceTaskTitle } from '@/lib/debug/lens';
import type { ArchitectAgentResponse, DeveloperAgentResponse, QaAgentResponse, ReviewerAgentResponse, StructuredAgentResponse } from '@/lib/llm/types';
import { eventBus } from '@/lib/simulation/eventBus';
import { getSessionId } from '@/lib/supabase/session';
import { useDebugStore } from '@/store/debugStore';
import { useLensStore } from '@/store/lensStore';
import { useSimStore } from '@/store/simulationStore';
import { recordAgentInvocation, useTraceStore } from '@/store/traceStore';
import type { AgentRole, AgentStatus, SimTask, TaskPriority, TaskStatus } from '@/types';

type AskRole = Exclude<AgentRole, 'planner'>;

const STATUS_STYLES: Record<TaskStatus, { bg: string; text: string; label: string }> = {
  backlog: { bg: '#1E293B', text: '#94A3B8', label: 'BACKLOG' },
  in_progress: { bg: '#1C3151', text: '#60A5FA', label: 'WIP' },
  review: { bg: '#2D1F47', text: '#C084FC', label: 'REVIEW' },
  done: { bg: '#14261E', text: '#34D399', label: 'DONE' },
};
const PRIORITY_COLORS: Record<TaskPriority, string> = { high: '#EF4444', medium: '#F97316', low: '#94A3B8' };
const ROLE_EMOJIS: Record<AgentRole, string> = { planner: '📋', architect: '🏗️', developer: '💻', reviewer: '🔍', qa: '🧪' };
const WORK_STATUS: Record<AskRole, AgentStatus> = { architect: 'thinking', developer: 'coding', reviewer: 'reviewing', qa: 'testing' };
const ASK_LABEL: Record<AskRole, string> = { architect: 'Ask Architect', developer: 'Ask Developer', reviewer: 'Ask Reviewer', qa: 'Ask QA' };

function formatDescription(description: string): string {
  return description.match(/original="([\s\S]+)"$/)?.[1] ?? description;
}
function list(value: string[]): string { return value.slice(0, 4).join(' / ').slice(0, 320); }
function timestamp(): number { return Date.now(); }

function responseMessages(result: StructuredAgentResponse): string[] {
  switch (result.role) {
    case 'architect': {
      const r: ArchitectAgentResponse = result;
      return [`설계 검토 완료: ${r.summary}`, `설계 노트: ${list(r.architectureNotes)}`, `데이터 흐름: ${list(r.dataFlow)}`];
    }
    case 'developer': {
      const r: DeveloperAgentResponse = result;
      return [`구현 계획 완료: ${r.summary}`, `수정 예상 파일: ${list(r.filesToChange)}`, `테스트 계획: ${list(r.testPlan)}`];
    }
    case 'reviewer': {
      const r: ReviewerAgentResponse = result;
      return [`코드 리뷰 완료: ${r.summary}`, `수정 권장사항: ${list(r.suggestedChanges)}`, `승인 상태: ${r.approvalStatus}`];
    }
    case 'qa': {
      const r: QaAgentResponse = result;
      return [`테스트 계획 완료: ${r.summary}`, `테스트 케이스: ${list(r.testCases)}`, `최종 검증 상태: ${r.finalStatus}`];
    }
  }
}

export default function TaskQueue() {
  const tasks = useSimStore(s => s.tasks);
  const filters = useLensStore(s => s.filters);
  const clear = useLensStore(s => s.clear);
  const remoteTraces = useTraceStore(s => s.remoteTraces);
  const localTraces = useTraceStore(s => s.localTraces);
  const imported = useTraceStore(s => s.importedBundle);
  const selectedSessionId = useTraceStore(s => s.selectedSessionId);
  const recordResponse = useDebugStore(s => s.recordAgentResponse);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const traces = imported?.traces ?? mergeTraces(remoteTraces, localTraces);
  const filtered = filterTasks(tasks, traces, filters, getSessionId());
  const selectedTitles = new Set(traces.filter(trace => trace.session_id === selectedSessionId).map(getTraceTaskTitle).filter(Boolean).map(title => title.toLowerCase()));

  async function askAgent(task: SimTask, role: AskRole) {
    if (busyTaskId || imported) return;
    const sessionId = getSessionId();
    const calledAt = timestamp();
    const previous = useSimStore.getState().agents[role];
    const activeTask = `Ask ${role}: ${task.title}`;
    setBusyTaskId(task.id);
    useSimStore.getState().setStatus(role, WORK_STATUS[role]);
    useSimStore.getState().setTask(role, activeTask);
    useSimStore.getState().setSpeech(role, `${ASK_LABEL[role]} 검토 중...`);
    try {
      const response = await fetch(`/api/agents/${role}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskTitle: task.title, taskDescription: formatDescription(task.description), sessionId }),
      });
      if (!response.ok) throw new Error('request_failed');
      const result = await response.json() as StructuredAgentResponse;
      if (result.role !== role || !result.summary) throw new Error('invalid_response');
      recordResponse(role, result);
      recordAgentInvocation({
        sessionId, agentId: role, taskTitle: task.title, calledAt,
        provider: result.provider, traceRecorded: result.traceRecorded ?? false,
      }, {
        model: result.model, latencyMs: result.latencyMs, inputTokens: result.inputTokens, outputTokens: result.outputTokens,
        metadata: {
          ...('approvalStatus' in result ? { approvalStatus: result.approvalStatus } : {}),
          ...('finalStatus' in result ? { finalStatus: result.finalStatus } : {}),
        },
      });
      responseMessages(result).forEach(message => eventBus.emit('agent.message', { agentId: role, data: { message, taskTitle: task.title, provider: result.provider } }));
      const speech = result.summary.slice(0, 72);
      useSimStore.getState().setSpeech(role, speech);
      window.setTimeout(() => {
        if (useSimStore.getState().agents[role].speech === speech) useSimStore.getState().setSpeech(role, null);
      }, 5000);
    } catch {
      recordResponse(role, { provider: 'mock', traceRecorded: false, model: 'mock-fallback', latencyMs: null, inputTokens: null, outputTokens: null });
      recordAgentInvocation({ sessionId, agentId: role, taskTitle: task.title, calledAt, provider: null, traceRecorded: false, failed: true });
      eventBus.emit('agent.message', { agentId: role, data: { message: '요청 실패. 기존 mock simulation은 계속 동작합니다.', taskTitle: task.title } });
      useSimStore.getState().setSpeech(role, '요청 실패 · mock 유지');
    } finally {
      const state = useSimStore.getState();
      if (state.agents[role].currentTask === activeTask) {
        state.setStatus(role, previous.status);
        state.setTask(role, previous.currentTask);
      }
      setBusyTaskId(null);
    }
  }

  const grouped: Record<TaskStatus, SimTask[]> = {
    in_progress: filtered.filter(t => t.status === 'in_progress'),
    review: filtered.filter(t => t.status === 'review'),
    backlog: filtered.filter(t => t.status === 'backlog'),
    done: filtered.filter(t => t.status === 'done'),
  };

  return (
    <div className="panel task-queue-panel">
      <div className="panel-header"><span>📋 TASK QUEUE</span><span className="panel-badge">{filtered.length}/{tasks.length}</span></div>
      <div className="panel-body task-list-body">
        {filtered.length === 0 && <div className="lens-empty">No matching tasks. <button type="button" onClick={clear}>Clear all</button></div>}
        {(['in_progress', 'review', 'backlog', 'done'] as TaskStatus[]).map(status => {
          const group = grouped[status];
          if (!group.length) return null;
          const style = STATUS_STYLES[status];
          return <div key={status}>
            <div className="task-group-label">— {style.label} ({group.length}) —</div>
            {group.map(task => {
              const highlighted = selectedTitles.has(task.title.toLowerCase());
              const role = task.assignedTo;
              return <article key={task.id} className={`task-card${highlighted ? ' task-card--correlated' : ''}`} style={{ background: style.bg, borderColor: `${style.text}33`, borderLeftColor: highlighted ? '#FBBF24' : style.text }}>
                <div className="task-card-line">
                  <strong style={{ color: style.text }}><HighlightedText text={task.title} query={filters.keyword} /></strong>
                  <span style={{ color: PRIORITY_COLORS[task.priority] }}>{'●'.repeat(task.priority === 'high' ? 3 : task.priority === 'medium' ? 2 : 1)}</span>
                </div>
                <div className="task-card-line task-card-detail">
                  <span><HighlightedText text={formatDescription(task.description)} query={filters.keyword} /></span>
                  {role && <span className="task-role">{ROLE_EMOJIS[role]} {role}</span>}
                </div>
                <div className="task-card-actions">
                  {task.localOnly && <span className="local-only-badge">LOCAL ONLY</span>}
                  {highlighted && <span className="correlated-badge">● SESSION MATCH</span>}
                  {role && role !== 'planner' && !task.localOnly && <button type="button" className="task-ask-btn" disabled={Boolean(busyTaskId) || Boolean(imported)} onClick={() => void askAgent(task, role)}>{busyTaskId === task.id ? 'Thinking...' : ASK_LABEL[role]}</button>}
                </div>
              </article>;
            })}
          </div>;
        })}
      </div>
    </div>
  );
}
