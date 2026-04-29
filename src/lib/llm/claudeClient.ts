/**
 * Server-only Claude client placeholder.
 *
 * IMPORTANT:
 * - Do not import this module from Client Components.
 * - Do not call the Anthropic API until Phase 4 wiring is explicitly enabled.
 * - The running MVP should continue to use mockClaude.complete(...) to avoid cost.
 */

import 'server-only';

import type { LlmRequest, LlmResponse } from './types';

export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-6';

export function getClaudeModel(): string {
  return process.env.CLAUDE_MODEL?.trim() || DEFAULT_CLAUDE_MODEL;
}

export const claudeClient = {
  /**
   * TODO(Phase 4): Instantiate @anthropic-ai/sdk with ANTHROPIC_API_KEY.
   * TODO(Phase 4): Resolve the role system prompt from src/lib/agents/prompts.ts.
   * TODO(Phase 4): Call client.messages.create(...) on the server only.
   * TODO(Phase 4): Return real token usage and latency metrics.
   */
  async complete(request: LlmRequest): Promise<LlmResponse> {
    void request;

    throw new Error(
      'Claude API is intentionally disabled. Use mockClaude.complete(...) until Phase 4.',
    );
  },
};
