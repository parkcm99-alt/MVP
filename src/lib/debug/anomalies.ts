import type { AgentTraceRow } from '@/lib/supabase/types';
import type { AgentCallSnapshot } from '@/store/debugStore';
import { traceTaskTitle } from './lens';
import { redactText } from './sanitize';

export interface TraceAnomaly {
  code: string;
  signature: string;
  summary: string;
  hint: string;
}

const FAILURE = new Set(['failed', 'changes_requested', 'needs_more_info', 'needs_more_testing']);

function normalized(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function safeTitle(value: string): string {
  return redactText(value).slice(0, 60) || 'untitled task';
}

function signature(code: string, role: string, title = ''): string {
  return `${code}:${normalized(role)}:${normalized(safeTitle(title))}`;
}

function traceTime(trace: AgentTraceRow): number {
  const value = Date.parse(trace.created_at);
  return Number.isFinite(value) ? value : 0;
}

export function detectTraceAnomalies(traces: AgentTraceRow[], calls: AgentCallSnapshot[]): TraceAnomaly[] {
  const found = new Map<string, TraceAnomaly>();
  const add = (anomaly: TraceAnomaly) => { if (!found.has(anomaly.signature)) found.set(anomaly.signature, anomaly); };

  calls.filter(call => call.completedAt && call.traceRecorded === false).forEach(call => add({
    code: 'trace_not_recorded',
    signature: signature('trace_not_recorded', call.role, call.taskTitle),
    summary: `${call.role} returned traceRecorded=false for “${safeTitle(call.taskTitle)}”.`,
    hint: call.provider === 'mock'
      ? 'Mock mode is cost-free and expected not to persist llm_call; keep it enabled unless live testing is intended.'
      : 'Check server-only Supabase credentials and agent_traces insert policy, then retry safely.',
  }));

  traces.filter(trace => trace.metadata?.traceRecorded === false).forEach(trace => add({
    code: 'trace_not_recorded',
    signature: signature('trace_not_recorded', trace.agent_id, traceTaskTitle(trace)),
    summary: `${trace.agent_id} telemetry reports an unrecorded trace.`,
    hint: 'Check the server trace write path and refresh the session timeline.',
  }));

  traces.filter(trace => trace.trace_type === 'handoff' && trace.agent_id === 'planner').forEach(handoff => {
    const title = traceTaskTitle(handoff);
    const target = normalized(handoff.metadata?.target_agent);
    const hasDecision = traces.some(trace => trace.trace_type === 'decision'
      && normalized(trace.agent_id) === target
      && normalized(traceTaskTitle(trace)) === normalized(title)
      && traceTime(trace) >= traceTime(handoff));
    if (!hasDecision) add({
      code: 'handoff_without_decision',
      signature: signature('handoff_without_decision', target, title),
      summary: `Planner handoff to ${target || 'an agent'} has no start decision for “${safeTitle(title)}”.`,
      hint: 'Allow the mini workflow to start, refresh traces, and check the assigned task state.',
    });
  });

  calls.filter(call => call.completedAt).forEach(call => {
    // Bound the match to this particular Ask invocation. An older trace for a
    // repeated task title must not hide a missing llm_call on the newest call.
    const earliest = call.startedAt - 5_000;
    const latest = (call.completedAt ?? Date.now()) + 5_000;
    const hasLlm = traces.some(trace => trace.trace_type === 'llm_call'
      && trace.agent_id === call.role
      && normalized(traceTaskTitle(trace)) === normalized(call.taskTitle)
      && traceTime(trace) >= earliest
      && traceTime(trace) <= latest);
    if (!hasLlm) add({
      code: 'ask_without_llm_call',
      signature: signature('ask_without_llm_call', call.role, call.taskTitle),
      summary: `Ask ${call.role} completed without a matching llm_call for “${safeTitle(call.taskTitle)}”.`,
      hint: call.provider === 'mock'
        ? 'This is expected in mock mode; no paid request was made.'
        : 'Refresh recent traces and verify the server awaited the trace insert.',
    });
  });

  traces.filter(trace => (trace.latency_ms ?? 0) >= 10_000).forEach(trace => add({
    code: 'high_latency',
    signature: signature('high_latency', trace.agent_id, traceTaskTitle(trace)),
    summary: `${trace.agent_id} trace latency reached ${trace.latency_ms}ms.`,
    hint: 'Check provider/network health and keep timeout and token limits in place.',
  }));

  traces.forEach(trace => {
    const status = normalized(trace.metadata?.finalStatus ?? trace.metadata?.approvalStatus);
    if (FAILURE.has(status)) add({
      code: 'failure_status',
      signature: signature(`failure_status:${status}`, trace.agent_id, traceTaskTitle(trace)),
      summary: `${trace.agent_id} reported ${status} for “${safeTitle(traceTaskTitle(trace))}”.`,
      hint: 'Review the finding and route a focused follow-up to Reviewer, QA, or Developer.',
    });
  });
  calls.forEach(call => {
    const status = normalized(call.finalStatus ?? call.approvalStatus);
    if (FAILURE.has(status)) add({
      code: 'failure_status',
      signature: signature(`failure_status:${status}`, call.role, call.taskTitle),
      summary: `${call.role} reported ${status} for “${safeTitle(call.taskTitle)}”.`,
      hint: 'Review the result and create a focused local debug finding if needed.',
    });
  });

  return [...found.values()].slice(0, 30);
}
