import type { LlmProvider } from '@/lib/llm/types';
import type { AgentTraceRow } from '@/lib/supabase/types';
import type { Agent, AgentRole, SimEvent, SimTask } from '@/types';

export interface TraceInvocation {
  id: string;
  sessionId: string;
  agentId: AgentRole;
  taskTitle: string;
  calledAt: number;
  completedAt: number;
  provider: LlmProvider | null;
  traceRecorded: boolean | null;
  failed?: boolean;
}

export interface TraceAnomaly {
  code: 'trace_not_recorded' | 'missing_decision' | 'missing_llm_call' | 'slow_call' | 'failed_outcome';
  signature: string;
  summary: string;
  hint: string;
}

export interface TraceBundle {
  schemaVersion: 1;
  exportedAt: string;
  sessionId: string;
  traces: AgentTraceRow[];
  tasks: SimTask[];
  events: SimEvent[];
  agents: Agent[];
  invocations: TraceInvocation[];
}
