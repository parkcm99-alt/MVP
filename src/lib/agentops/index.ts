/**
 * AgentOps observability stub.
 *
 * Future wiring:
 *   import * as agentops from 'agentops';
 *   agentops.init({ apiKey: process.env.AGENTOPS_API_KEY });
 *
 * React Flow workflow graph stub is also here:
 *   - WorkflowNode definitions mirror the LangGraph/CrewAI graph topology
 *   - Connect to React Flow <ReactFlow nodes={...} edges={...} /> for visualization
 */

import type { AgentOpsEvent, AgentRole, WorkflowNode } from '@/types';

/** @stub Send an agent action event to AgentOps */
export function trackEvent(event: AgentOpsEvent): void {
  void event; // stub — agentops.trackEvent(event) when connected
}

/** @stub Start an AgentOps session */
export function startSession(sessionId: string): void {
  void sessionId; // stub — agentops.startSession({ sessionId, tags: ['simulation'] })
}

/** @stub End an AgentOps session */
export function endSession(sessionId: string): void {
  void sessionId; // stub — agentops.endSession(sessionId)
}

// ─── React Flow / LangGraph workflow topology ────────────────────────────

export const WORKFLOW_NODES: WorkflowNode[] = [
  { id: 'start',     type: 'condition', label: 'START' },
  { id: 'planner',   type: 'agent',     agentRole: 'planner',   label: 'Planner' },
  { id: 'architect', type: 'agent',     agentRole: 'architect', label: 'Architect' },
  { id: 'developer', type: 'agent',     agentRole: 'developer', label: 'Developer' },
  { id: 'reviewer',  type: 'agent',     agentRole: 'reviewer',  label: 'Reviewer' },
  { id: 'qa',        type: 'agent',     agentRole: 'qa',        label: 'QA' },
  { id: 'end',       type: 'condition', label: 'END' },
];

export const WORKFLOW_EDGES = [
  { id: 'e1', source: 'start',     target: 'planner'   },
  { id: 'e2', source: 'planner',   target: 'architect' },
  { id: 'e3', source: 'architect', target: 'developer' },
  { id: 'e4', source: 'developer', target: 'reviewer'  },
  { id: 'e5', source: 'reviewer',  target: 'qa'        },
  { id: 'e6', source: 'qa',        target: 'end'       },
  { id: 'e7', source: 'qa',        target: 'developer', label: 'bug found' },
];

/** Current active node in the workflow (for React Flow highlighting) */
export function getActiveNode(agentRole: AgentRole): string {
  return agentRole;
}
