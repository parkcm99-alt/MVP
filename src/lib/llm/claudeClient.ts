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

export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const CLAUDE_MAX_TOKENS = 320;
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

function getModelCandidates(): string[] {
  const configured = process.env.CLAUDE_MODEL?.trim();
  return [...new Set([configured, DEFAULT_CLAUDE_MODEL].filter(Boolean) as string[])];
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message.toLowerCase() : '';
}

function getErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

function getProviderErrorType(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const directType = (error as { type?: unknown }).type;
  if (typeof directType === 'string') return directType;

  const nested = (error as { error?: unknown }).error;
  if (!nested || typeof nested !== 'object') return undefined;
  const nestedType = (nested as { type?: unknown }).type;
  return typeof nestedType === 'string' ? nestedType : undefined;
}

function classifyClaudeError(error: unknown): string {
  const status = getErrorStatus(error);
  const type = getProviderErrorType(error);
  const message = getErrorMessage(error);

  if (
    status === 404 ||
    type === 'not_found_error' ||
    message.includes('not_found') ||
    message.includes('not found') ||
    message.includes('does not exist') ||
    (message.includes('model') && (message.includes('not') || message.includes('unsupported')))
  ) {
    return 'model_not_found';
  }
  if (status === 401 || type === 'authentication_error' || message.includes('api key')) {
    return 'invalid_api_key';
  }
  if (status === 402 || type === 'billing_error' || message.includes('credit') || message.includes('billing')) {
    return 'insufficient_credit';
  }
  if (status === 429 || type === 'rate_limit_error') {
    return 'rate_limited';
  }
  if (type === 'timeout_error' || message.includes('timeout') || message.includes('aborted')) {
    return 'timeout';
  }
  if (status === 403 || type === 'permission_error') {
    return 'permission_denied';
  }
  if (status === 400 || type === 'invalid_request_error') {
    return 'bad_request';
  }
  if (status === undefined) {
    return 'network_error';
  }
  return 'claude_request_failed';
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
    const client = new Anthropic({
      apiKey,
      timeout: CLAUDE_TIMEOUT_MS,
      maxRetries: 0,
    });
    let lastReason = 'claude_request_failed';

    for (const model of getModelCandidates()) {
      const timeout = createTimeoutSignal(CLAUDE_TIMEOUT_MS);

      try {
        const message = await client.messages.create(
          {
            model,
            max_tokens: Math.min(request.maxTokens ?? CLAUDE_MAX_TOKENS, CLAUDE_MAX_TOKENS),
            system: request.systemPrompt,
            messages: request.messages,
          },
          {
            signal: timeout.signal,
            timeout: CLAUDE_TIMEOUT_MS,
            maxRetries: 0,
          },
        );

        return {
          provider:       'claude',
          content:        getTextContent(message.content),
          inputTokens:    message.usage.input_tokens,
          outputTokens:   message.usage.output_tokens,
          latencyMs:      Date.now() - startedAt,
          model:          message.model,
          fallbackReason: model === getClaudeModel() ? undefined : 'model_fallback',
        };
      } catch (error) {
        lastReason = classifyClaudeError(error);
        if (lastReason === 'model_not_found' && model !== DEFAULT_CLAUDE_MODEL) {
          console.warn(`Claude request failed: ${lastReason}; retrying default_model`);
          continue;
        }
        console.warn(`Claude request failed: ${lastReason}`);
        break;
      } finally {
        timeout.cleanup();
      }
    }

    return {
      ...(await mockClaude.complete(request)),
      fallbackReason: lastReason,
    };
  },
};
