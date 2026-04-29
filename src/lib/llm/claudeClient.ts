/**
 * Server-only Claude client.
 *
 * IMPORTANT:
 * - Do not import this module from Client Components.
 * - Live calls are gated by the API route with ENABLE_LIVE_LLM=true + key.
 * - Errors return a sanitized mock fallback rather than leaking provider details.
 */

import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import type { Message } from '@anthropic-ai/sdk/resources/messages';
import { mockClaude } from './mockClaude';
import type { LlmRequest, LlmResponse } from './types';

export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-6';
const CLAUDE_MAX_TOKENS = 450;
const CLAUDE_TIMEOUT_MS = 8_000;

export function getClaudeModel(): string {
  return process.env.CLAUDE_MODEL?.trim() || DEFAULT_CLAUDE_MODEL;
}

function getTextContent(content: Message['content']): string {
  return content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim();
}

function createTimeoutSignal(ms: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer),
  };
}

export const claudeClient = {
  /**
   * Server-only Claude completion. Callers must gate live usage before invoking.
   * On any provider failure, this returns mock content with a sanitized reason.
   */
  async complete(request: LlmRequest): Promise<LlmResponse> {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) {
      return {
        ...(await mockClaude.complete(request)),
        fallbackReason: 'missing_api_key',
      };
    }

    const startedAt = Date.now();
    const timeout = createTimeoutSignal(CLAUDE_TIMEOUT_MS);

    try {
      const client = new Anthropic({
        apiKey,
        timeout: CLAUDE_TIMEOUT_MS,
        maxRetries: 0,
      });

      const message = await client.messages.create(
        {
          model: getClaudeModel(),
          max_tokens: Math.min(request.maxTokens ?? CLAUDE_MAX_TOKENS, CLAUDE_MAX_TOKENS),
          system: request.systemPrompt,
          messages: request.messages,
          output_config: {
            format: {
              type: 'json_schema',
              schema: {
                type: 'object',
                additionalProperties: false,
                required: ['summary', 'steps', 'risks', 'nextAgent'],
                properties: {
                  summary: { type: 'string' },
                  steps: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 4,
                    items: { type: 'string' },
                  },
                  risks: {
                    type: 'array',
                    minItems: 0,
                    maxItems: 3,
                    items: { type: 'string' },
                  },
                  nextAgent: { type: 'string' },
                },
              },
            },
          },
        },
        {
          signal: timeout.signal,
          timeout: CLAUDE_TIMEOUT_MS,
          maxRetries: 0,
        },
      );

      return {
        provider:     'claude',
        content:      getTextContent(message.content),
        inputTokens:  message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        latencyMs:    Date.now() - startedAt,
        model:        message.model,
      };
    } catch {
      return {
        ...(await mockClaude.complete(request)),
        fallbackReason: 'claude_request_failed',
      };
    } finally {
      timeout.cleanup();
    }
  },
};
