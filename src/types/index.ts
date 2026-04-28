export type AgentRole = 'planner' | 'architect' | 'developer' | 'reviewer' | 'qa';

export type AgentStatus =
  | 'idle'
  | 'walking'
  | 'thinking'
  | 'coding'
  | 'reviewing'
  | 'testing'
  | 'meeting'
  | 'blocked';

export type TaskStatus   = 'backlog' | 'in_progress' | 'review' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high';
export type EventType    = 'task' | 'meeting' | 'chat' | 'system' | 'review';

/** Typed event bus events (mock layer — see eventBus.ts) */
export type BusEventType =
  | 'task.created'
  | 'agent.assigned'
  | 'agent.moved'
  | 'agent.status.changed'
  | 'agent.message'
  | 'meeting.started'
  | 'task.completed'
  | 'issue.found';

export interface Position {
  x: number;
  y: number;
}

export interface Agent {
  id: AgentRole;
  name: string;
  role: AgentRole;
  emoji: string;
  primaryColor: string;
  spriteColor: string;
  pantColor: string;
  deskPosition: Position;
  position: Position;
  status: AgentStatus;
  currentTask: string | null;
  speech: string | null;
  completedTasks: number;
}

export interface SimTask {
  id: string;
  title: string;
  description: string;
  assignedTo: AgentRole | null;
  status: TaskStatus;
  priority: TaskPriority;
  createdAt: number;
  updatedAt: number;
}

export interface SimEvent {
  id: string;
  timestamp: number;
  agentId: AgentRole;
  agentName: string;
  agentColor: string;
  type: EventType;
  message: string;
}

// ──────────────────────────────────────────────
// Future integration interfaces (not yet wired)
// ──────────────────────────────────────────────

/** Claude API message format (Anthropic SDK) */
export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** AgentOps event (to be sent via agentops SDK) */
export interface AgentOpsEvent {
  agentId: AgentRole;
  eventName: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

/** Supabase Realtime channel payload */
export interface RealtimePayload {
  type: 'agent_update' | 'task_update' | 'new_event';
  data: unknown;
}

/** LangGraph / CrewAI node definition */
export interface WorkflowNode {
  id: string;
  type: 'agent' | 'tool' | 'condition';
  agentRole?: AgentRole;
  label: string;
}
