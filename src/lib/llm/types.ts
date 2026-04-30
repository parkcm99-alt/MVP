/**
 * LLM abstraction types — shared by mockClaude and claudeClient.
 *
 * Design goals:
 *   • Provider-agnostic surface — swapping mock ↔ real Claude changes only
 *     the implementation, not the call sites.
 *   • Server-only intent — these types describe server-side objects.
 *     Client components should never import claudeClient directly.
 */

import type { AgentRole } from '@/types';

// ── Provider ──────────────────────────────────────────────────────────────────

/** Which underlying provider is active. */
export type LlmProvider = 'mock' | 'claude';

// ── Message ───────────────────────────────────────────────────────────────────

export type LlmRole = 'user' | 'assistant';

export interface LlmMessage {
  role:    LlmRole;
  content: string;
}

// ── Request ───────────────────────────────────────────────────────────────────

export interface LlmRequest {
  /** Agent role driving this request — used to look up the system prompt. */
  agentRole:    AgentRole;

  /** Conversation history passed to the model. */
  messages:     LlmMessage[];

  /**
   * Optional override for the system prompt.
   * When omitted the default prompt from prompts.ts is used.
   */
  systemPrompt?: string;

  /** Max tokens to generate. Defaults to 512 when omitted. */
  maxTokens?:   number;

  /**
   * Explicit model override for this request.
   * When provided, claudeClient uses this model instead of CLAUDE_MODEL.
   * Populated by each route via getModelForRole().
   */
  model?:       string;
}

// ── Response ──────────────────────────────────────────────────────────────────

export interface LlmResponse {
  /** Provider that produced this response. */
  provider:   LlmProvider;

  /** Generated text content. */
  content:    string;

  /** Input tokens consumed (0 for mock, null if a live provider omits usage). */
  inputTokens:  number | null;

  /** Output tokens consumed (0 for mock, null if a live provider omits usage). */
  outputTokens: number | null;

  /** Wall-clock latency in ms (0 for mock). */
  latencyMs:  number;

  /** Model name used (e.g. 'claude-sonnet-4-6' or 'mock'). */
  model:      string;

  /** Sanitized fallback reason, never raw provider errors or secrets. */
  fallbackReason?: string;
}

// ── Agent role prompt ─────────────────────────────────────────────────────────

/** System prompt definition for a single agent role. */
export interface AgentRolePrompt {
  role:         AgentRole;
  systemPrompt: string;
  /** Short label shown in the UI trace card. */
  label:        string;
}

export interface PlannerAgentResponse {
  ok: boolean;
  provider: 'mock' | 'claude';
  role: 'planner';
  summary: string;
  steps: string[];
  risks: string[];
  nextAgent: string;
  debugReason?: string;
  traceRecorded?: boolean;
  model?: string | null;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
}

export interface ArchitectAgentResponse {
  ok: boolean;
  provider: 'mock' | 'claude';
  role: 'architect';
  summary: string;
  architectureNotes: string[];
  dataFlow: string[];
  risks: string[];
  nextAgent: 'developer' | 'reviewer' | 'qa';
  debugReason?: string;
  traceRecorded?: boolean;
  model?: string | null;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
}

export interface DeveloperAgentResponse {
  ok: boolean;
  provider: 'mock' | 'claude';
  role: 'developer';
  summary: string;
  implementationPlan: string[];
  filesToChange: string[];
  testPlan: string[];
  risks: string[];
  nextAgent: 'reviewer' | 'qa';
  debugReason?: string;
  traceRecorded?: boolean;
  model?: string | null;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
}

export interface ReviewerAgentResponse {
  ok: boolean;
  provider: 'mock' | 'claude';
  role: 'reviewer';
  summary: string;
  reviewFindings: string[];
  suggestedChanges: string[];
  risks: string[];
  approvalStatus: 'approved' | 'changes_requested' | 'needs_more_info';
  nextAgent: 'developer' | 'qa';
  debugReason?: string;
  traceRecorded?: boolean;
  model?: string | null;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
}

export interface QaAgentResponse {
  ok: boolean;
  provider: 'mock' | 'claude';
  role: 'qa';
  summary: string;
  testCases: string[];
  regressionChecks: string[];
  qualityRisks: string[];
  finalStatus: 'passed' | 'failed' | 'needs_more_testing';
  nextAgent: 'developer' | 'reviewer' | 'planner';
  debugReason?: string;
  traceRecorded?: boolean;
  model?: string | null;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
}
