import type { TraceAnomaly, TraceInvocation } from '@/lib/debug/types';
import { getTraceTaskTitle } from '@/lib/debug/lens';
import type { AgentTraceRow } from '@/lib/supabase/types';

function norm(value: string): string { return value.trim().toLowerCase().replace(/\s+/g, ' '); }
function sameTitle(a: string, b: string): boolean { return norm(a) === norm(b); }

/** Merge server rows with ephemeral mirrors without showing a live call twice. */
export function mergeTraces(remote: AgentTraceRow[], local: AgentTraceRow[]): AgentTraceRow[] {
  const merged = [...remote];
  for (const item of local) {
    const duplicate = remote.some(row => row.session_id === item.session_id
      && row.agent_id === item.agent_id && row.trace_type === item.trace_type
      && sameTitle(getTraceTaskTitle(row), getTraceTaskTitle(item))
      && Math.abs(Date.parse(row.created_at) - Date.parse(item.created_at)) < 15_000);
    if (!duplicate) merged.push(item);
  }
  return merged.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 100);
}

export function detectAnomalies(traces: AgentTraceRow[], invocations: TraceInvocation[], now = Date.now()): TraceAnomaly[] {
  const found = new Map<string, TraceAnomaly>();
  const add = (anomaly: TraceAnomaly) => found.set(anomaly.signature, anomaly);
  for (const call of invocations) {
    const task = call.taskTitle.slice(0, 40);
    if (call.traceRecorded === false) {
      const signature = `trace_not_recorded:${call.agentId}:${norm(call.taskTitle)}`;
      add({ code: 'trace_not_recorded', signature,
        summary: `${call.agentId} returned traceRecorded false for “${task}”.`,
        hint: call.provider === 'mock' ? 'Expected in cost-safe mock mode; enable live tracing only when intended.' : 'Check server Supabase keys/RLS, then retry and refresh.' });
    }
    const hasCall = traces.some(trace => trace.trace_type === 'llm_call' && trace.agent_id === call.agentId
      && sameTitle(getTraceTaskTitle(trace), call.taskTitle)
      && Math.abs(Date.parse(trace.created_at) - call.calledAt) < 60_000);
    if (!hasCall) {
      add({ code: 'missing_llm_call', signature: `missing_llm_call:${call.agentId}:${norm(call.taskTitle)}`,
        summary: `Ask ${call.agentId} completed without an llm_call for “${task}”.`,
        hint: 'Refresh traces and check the API response/network path; mock simulation remains safe.' });
    }
  }
  for (const trace of traces) {
    const task = getTraceTaskTitle(trace) || 'untitled task';
    if (trace.metadata?.trace_recorded === false) {
      const signature = `trace_not_recorded:${trace.agent_id}:${norm(task)}`;
      add({ code: 'trace_not_recorded', signature,
        summary: `${trace.agent_id} returned traceRecorded false for “${task.slice(0, 40)}”.`,
        hint: trace.metadata?.provider === 'mock' ? 'Expected in cost-safe mock mode; enable live tracing only when intended.' : 'Check server Supabase keys/RLS, then retry and refresh.' });
    }
    if (trace.trace_type === 'handoff' && trace.agent_id === 'planner') {
      const target = typeof trace.metadata?.target_agent === 'string' ? trace.metadata.target_agent : '';
      const age = now - Date.parse(trace.created_at);
      const decision = traces.some(row => row.trace_type === 'decision' && row.agent_id === target && sameTitle(getTraceTaskTitle(row), task));
      if (!decision && age > 7_000) add({ code: 'missing_decision', signature: `missing_decision:${target}:${norm(task)}`,
        summary: `Planner handoff to ${target || 'an agent'} has no decision for “${task.slice(0, 40)}”.`,
        hint: 'Wait for the queued workflow, refresh, or inspect the assigned task state.' });
    }
    if (typeof trace.latency_ms === 'number' && trace.latency_ms >= 10_000) {
      add({ code: 'slow_call', signature: `slow_call:${trace.id}`,
        summary: `${trace.agent_id} ${trace.trace_type} took ${trace.latency_ms}ms (≥10000ms).`,
        hint: 'Check provider/network latency and keep timeout/max-token limits in place.' });
    }
    const outcome = trace.metadata?.finalStatus ?? trace.metadata?.approvalStatus;
    if (typeof outcome === 'string' && ['failed', 'changes_requested', 'needs_more_info', 'needs_more_testing'].includes(outcome)) {
      add({ code: 'failed_outcome', signature: `failed_outcome:${trace.agent_id}:${norm(task)}:${outcome}`,
        summary: `${trace.agent_id} reported ${outcome} for “${task.slice(0, 40)}”.`,
        hint: 'Review the finding and route a focused follow-up to developer, reviewer, or QA.' });
    }
  }
  return [...found.values()];
}
