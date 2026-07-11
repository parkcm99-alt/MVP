'use client';

import { useState } from 'react';
import { eventBus } from '@/lib/simulation/eventBus';
import { getSessionId } from '@/lib/supabase/session';
import { useDebugStore } from '@/store/debugStore';
import { useSimStore } from '@/store/simulationStore';
import { useTraceDebugStore } from '@/store/traceDebugStore';
import { textMatches, useOperationsLensStore } from '@/store/operationsLensStore';
import type { AgentRole, SimTask, TaskPriority, TaskStatus } from '@/types';

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
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const recordAgentResponse = useDebugStore(s => s.recordAgentResponse);
  const highlightedTaskTitles = useTraceDebugStore(s => s.highlightedTaskTitles);
  const addLocalTrace = useTraceDebugStore(s => s.addLocalTrace);
  const localTraces = useTraceDebugStore(s => s.localTraces);
  const remoteTraces = useTraceDebugStore(s => s.remoteTraces);
  const lens = {
    agentRole: useOperationsLensStore(s => s.agentRole),
    taskStatus: useOperationsLensStore(s => s.taskStatus),
    priority: useOperationsLensStore(s => s.priority),
    traceType: useOperationsLensStore(s => s.traceType),
    sessionId: useOperationsLensStore(s => s.sessionId),
    keyword: useOperationsLensStore(s => s.keyword),
  };
  const clearLens = useOperationsLensStore(s => s.clearAll);
  const sessionMatches = !lens.sessionId || getSessionId().toLowerCase().includes(lens.sessionId.toLowerCase());
  const filteredTasks = tasks.filter(task =>
    sessionMatches &&
    (!lens.agentRole || task.assignedTo === lens.agentRole) &&
    (!lens.taskStatus || task.status === lens.taskStatus) &&
    (!lens.priority || task.priority === lens.priority) &&
    textMatches(lens.keyword, task.title, task.description, task.assignedTo, task.status, task.priority) &&
    (!lens.traceType || [...localTraces, ...remoteTraces].some(trace =>
      trace.trace_type === lens.traceType && trace.metadata?.task_title === task.title)),
  );
  const highlight = (value: string) => {
    const needle = lens.keyword.trim();
    if (!needle) return value;
    const index = value.toLowerCase().indexOf(needle.toLowerCase());
    return index < 0 ? value : <>{value.slice(0, index)}<mark className="lens-mark">{value.slice(index, index + needle.length)}</mark>{value.slice(index + needle.length)}</>;
  };

  async function askAssignedAgent(task: SimTask, role: Exclude<AgentRole, 'planner'>) {
    if (busyTaskId) return;
    setBusyTaskId(task.id);
    addLocalTrace({ agent_id: role, trace_type: 'tool_use', metadata: { action: 'Ask Agent', task_title: task.title } });
    try {
      const response = await fetch(`/api/agents/${role}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskTitle: task.title,
          taskDescription: task.description,
          sessionId: getSessionId(),
        }),
      });
      const result = await response.json() as Record<string, unknown>;
      const provider = result.provider === 'claude' ? 'claude' : 'mock';
      recordAgentResponse({
        role,
        provider,
        traceRecorded: result.traceRecorded === true,
        model: typeof result.model === 'string' ? result.model : null,
        latencyMs: typeof result.latencyMs === 'number' ? result.latencyMs : null,
        inputTokens: typeof result.inputTokens === 'number' ? result.inputTokens : null,
        outputTokens: typeof result.outputTokens === 'number' ? result.outputTokens : null,
        taskTitle: task.title,
        resultStatus: typeof result.finalStatus === 'string' ? result.finalStatus : typeof result.approvalStatus === 'string' ? result.approvalStatus : undefined,
      });

      const summary = typeof result.summary === 'string' ? result.summary : '응답이 비어 있습니다.';
      const labels: Record<Exclude<AgentRole, 'planner'>, string> = {
        architect: '[Architect] 설계 검토 완료',
        developer: '[Developer] 구현 계획 완료',
        reviewer: '[Reviewer] 코드 리뷰 완료',
        qa: '[QA] 테스트 계획 완료',
      };
      eventBus.emit('agent.message', {
        agentId: role,
        data: { message: `${labels[role]}: ${summary}`, provider },
      });

      const details: Record<Exclude<AgentRole, 'planner'>, Array<[string, string]>> = {
        architect: [['architectureNotes', '[Architect] 설계 메모']],
        developer: [['filesToChange', '[Developer] 수정 예상 파일'], ['testPlan', '[Developer] 테스트 계획']],
        reviewer: [['suggestedChanges', '[Reviewer] 수정 권장사항'], ['approvalStatus', '[Reviewer] 승인 상태']],
        qa: [['testCases', '[QA] 테스트 케이스'], ['finalStatus', '[QA] 최종 검증 상태']],
      };
      for (const [field, label] of details[role]) {
        const value = result[field];
        const display = Array.isArray(value) ? value.join(' · ') : typeof value === 'string' ? value : '';
        if (display) {
          eventBus.emit('agent.message', { agentId: role, data: { message: `${label}: ${display}` } });
        }
      }
    } catch {
      recordAgentResponse({ role, provider: 'mock', traceRecorded: false, recordTrace: false });
      addLocalTrace({ agent_id: role, trace_type: 'tool_use', metadata: { action: 'Ask Agent failed', task_title: task.title, traceRecorded: false } });
      eventBus.emit('agent.message', {
        agentId: role,
        data: { message: `[${role}] 호출 실패. mock simulation은 계속됩니다.` },
      });
    } finally {
      setBusyTaskId(null);
    }
  }

  const grouped: Record<TaskStatus, typeof tasks> = {
    in_progress: filteredTasks.filter(t => t.status === 'in_progress'),
    review:      filteredTasks.filter(t => t.status === 'review'),
    backlog:     filteredTasks.filter(t => t.status === 'backlog'),
    done:        filteredTasks.filter(t => t.status === 'done'),
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <span>📋 TASK QUEUE</span>
        <span className="panel-badge">{filteredTasks.length}/{tasks.length}</span>
        <button className="panel-collapse-btn" onClick={clearLens}>CLEAR ALL</button>
      </div>

      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {filteredTasks.length === 0 && <div className="lens-empty">No tasks match the Operations Lens.</div>}
        {(['in_progress', 'review', 'backlog', 'done'] as TaskStatus[]).map(status => {
          const group = grouped[status];
          if (group.length === 0) return null;
          const style = STATUS_STYLES[status];
          return (
            <div key={status}>
              <div style={{ fontSize: 9, color: '#475569', fontFamily: 'monospace', marginBottom: 3, letterSpacing: 1 }}>
                — {highlight(style.label)} ({group.length}) —
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
                    boxShadow: highlightedTaskTitles.includes(task.title) ? '0 0 0 2px #FDE047, 0 0 12px #FDE04766' : undefined,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                    <span style={{ fontSize: 10, color: style.text, fontFamily: 'monospace', fontWeight: 'bold', lineHeight: 1.25, overflowWrap: 'anywhere' }}>
                      {highlight(task.title)}
                    </span>
                    <span style={{ fontSize: 8, color: PRIORITY_COLORS[task.priority], fontFamily: 'monospace', flexShrink: 0 }}>
                      {'●'.repeat(task.priority === 'high' ? 3 : task.priority === 'medium' ? 2 : 1)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                    <span style={{ fontSize: 9, color: '#64748B', fontFamily: 'monospace', lineHeight: 1.25, overflowWrap: 'anywhere' }}>
                      {highlight(formatDescription(task.description))}
                    </span>
                    {task.assignedTo && (
                      <span style={{ fontSize: 9, color: '#64748B', fontFamily: 'monospace', flexShrink: 0 }}>
                        {ROLE_EMOJIS[task.assignedTo]} {highlight(task.assignedTo)}
                      </span>
                    )}
                  </div>
                  {task.status !== 'done' && task.assignedTo && task.assignedTo !== 'planner' && (
                    <button
                      type="button"
                      onClick={() => { void askAssignedAgent(task, task.assignedTo as Exclude<AgentRole, 'planner'>); }}
                      disabled={busyTaskId !== null}
                      style={{
                        marginTop: 3,
                        border: '1px solid #334155',
                        borderRadius: 3,
                        padding: '3px 6px',
                        background: '#0F172A',
                        color: '#93C5FD',
                        fontSize: 9,
                        fontFamily: 'monospace',
                        cursor: busyTaskId ? 'wait' : 'pointer',
                      }}
                    >
                      {busyTaskId === task.id ? 'Working…' : `Ask ${task.assignedTo[0].toUpperCase()}${task.assignedTo.slice(1)}`}
                    </button>
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
