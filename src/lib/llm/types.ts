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
}

// ── Response ──────────────────────────────────────────────────────────────────

export interface LlmResponse {
  /** Provider that produced this response. */
  provider:   LlmProvider;

  /** Generated text content. */
  content:    string;

  /** Input tokens consumed (0 for mock). */
  inputTokens:  number;

  /** Output tokens consumed (0 for mock). */
  outputTokens: number;

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
}
