/**
 * Claude API integration stub.
 *
 * Future wiring:
 *   import Anthropic from '@anthropic-ai/sdk';
 *   const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
 *
 * Each AgentRole maps to a system prompt that shapes LLM behavior.
 * The simulationEngine will call `runAgentTurn` instead of using mock data.
 */

import type { AgentRole, LLMMessage } from '@/types';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const SYSTEM_PROMPTS: Record<AgentRole, string> = {
  planner:   'You are a senior product manager. Break down user stories into concrete sprint tasks.',
  architect: 'You are a principal software architect. Design scalable, maintainable system architectures.',
  developer: 'You are a senior full-stack engineer. Write clean, tested, production-ready code.',
  reviewer:  'You are a senior code reviewer. Identify bugs, security issues, and style violations.',
  qa:        'You are a QA engineer. Design comprehensive test cases and catch edge cases.',
};

export interface AgentTurnParams {
  agentRole: AgentRole;
  taskDescription: string;
  conversationHistory: LLMMessage[];
}

export interface AgentTurnResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

/** @stub Replace with real Anthropic SDK call */
export async function runAgentTurn(params: AgentTurnParams): Promise<AgentTurnResult> {
  void params; // stub — client.messages.create(...) when connected
  throw new Error('Claude API not yet connected. Set ANTHROPIC_API_KEY and implement this function.');
}

/** @stub Streaming variant */
export async function* streamAgentTurn(params: AgentTurnParams): AsyncGenerator<string> {
  void params; // stub — client.messages.stream(...) when connected
  throw new Error('Claude API streaming not yet connected.');
}
