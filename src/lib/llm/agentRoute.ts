import 'server-only';

import { getAgentRolePrompt } from '@/lib/agents/prompts';
import { claudeClient } from '@/lib/llm/claudeClient';
import { normalizeText, parseJsonObject } from '@/lib/llm/json';
import { mockClaude } from '@/lib/llm/mockClaude';
import { insertAgentTrace } from '@/lib/supabase/traces';
import type { AgentRole } from '@/types';
import type { AgentResponseTelemetry, LlmProvider, LlmResponse } from './types';

interface AgentRequestBody {
  taskTitle?: unknown;
  taskDescription?: unknown;
  sessionId?: unknown;
  session_id?: unknown;
}

interface BaseAgentResponse extends AgentResponseTelemetry {
  ok: boolean;
  provider: LlmProvider;
  role: AgentRole;
  summary: string;
}

type TraceRecorder = (
  llm: LlmResponse,
  taskTitle: string,
  latencyMs: number,
  sessionId?: string,
  metadata?: Record<string, unknown>,
) => Promise<boolean>;

export interface AgentRouteConfig<T extends BaseAgentResponse> {
  role: AgentRole;
  schema: string;
  instructions: string;
  fallback: (summary?: string) => T;
  normalize: (parsed: Record<string, unknown>, provider: LlmProvider) => T;
  traceMetadata?: (response: T) => Record<string, unknown>;
  recordTrace?: TraceRecorder;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeSessionId(value: unknown): string | undefined {
  return typeof value === 'string' && UUID.test(value.trim()) ? value.trim() : undefined;
}

function withTelemetry<T extends BaseAgentResponse>(
  response: T,
  llm: LlmResponse,
  latencyMs: number,
  traceRecorded: boolean,
  debugReason?: string,
): T {
  return {
    ...response,
    traceRecorded,
    model: llm.model ?? null,
    latencyMs,
    inputTokens: llm.inputTokens ?? null,
    outputTokens: llm.outputTokens ?? null,
    ...(process.env.NODE_ENV !== 'production' && debugReason ? { debugReason } : {}),
  };
}

function buildSystemPrompt(role: AgentRole, instructions: string, schema: string): string {
  return [
    getAgentRolePrompt(role).systemPrompt,
    instructions,
    'SECURE OUTPUT CONTRACT: Return exactly one raw JSON object and nothing else.',
    'Never use markdown, code fences, headings, comments, or prose before or after the JSON.',
    'The complete response must be directly parseable by JSON.parse.',
    `Required JSON shape: ${schema}`,
    'Keep every array short and practical. Do not include secrets or credentials.',
  ].join('\n');
}

export async function recordAgentLlmTrace(
  agentId: AgentRole,
  llm: LlmResponse,
  taskTitle: string,
  latencyMs: number,
  sessionId?: string,
  metadata: Record<string, unknown> = {},
): Promise<boolean> {
  if (llm.provider !== 'claude') return false;
  return insertAgentTrace({
    sessionId,
    agentId,
    traceType: 'llm_call',
    inputTokens: llm.inputTokens,
    outputTokens: llm.outputTokens,
    latencyMs,
    model: llm.model,
    metadata: { provider: 'claude', task_title: taskTitle, ...metadata },
  });
}

/** One server-only execution path keeps cost guards and error handling identical for every role. */
export async function handleAgentPost<T extends BaseAgentResponse>(
  request: Request,
  config: AgentRouteConfig<T>,
): Promise<Response> {
  let body: AgentRequestBody;
  try {
    body = await request.json() as AgentRequestBody;
  } catch {
    return Response.json({
      ...config.fallback('Invalid JSON body. Expected { taskTitle, taskDescription, sessionId }.'),
      ok: false,
    }, { status: 400 });
  }

  const taskTitle = normalizeText(body.taskTitle, `${config.role} task`);
  const taskDescription = normalizeText(body.taskDescription, 'Review the task and recommend a safe next step.');
  const sessionId = normalizeSessionId(body.sessionId ?? body.session_id);
  const liveFlag = process.env.ENABLE_LIVE_LLM?.trim().toLowerCase();
  const liveEnabled = liveFlag === 'true';
  const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim());

  if (!liveEnabled || !hasApiKey) {
    const mock = await mockClaude.complete({
      agentRole: config.role,
      messages: [{ role: 'user', content: `Task: ${taskTitle}\nDescription: ${taskDescription}` }],
      maxTokens: 280,
    });
    return Response.json(withTelemetry(
      config.fallback(mock.content),
      mock,
      mock.latencyMs,
      false,
      !liveEnabled ? `live_disabled:${liveFlag ?? 'missing'}` : 'missing_api_key',
    ));
  }

  const startedAt = Date.now();
  const llm = await claudeClient.complete({
    agentRole: config.role,
    systemPrompt: buildSystemPrompt(config.role, config.instructions, config.schema),
    messages: [{
      role: 'user',
      content: [
        `Task title: ${taskTitle}`,
        `Task description: ${taskDescription}`,
        'Analyze only this task. Return the required raw JSON object now.',
      ].join('\n'),
    }],
    maxTokens: 320,
  });
  const latencyMs = Date.now() - startedAt;

  if (llm.provider !== 'claude') {
    return Response.json(withTelemetry(
      config.fallback(llm.content),
      llm,
      latencyMs,
      false,
      llm.fallbackReason,
    ));
  }

  let response: T;
  let debugReason: string | undefined;
  try {
    response = config.normalize(parseJsonObject(llm.content), 'claude');
  } catch {
    // Parsing is the only reason a successful Claude response uses the safe shape fallback.
    console.warn(`Claude ${config.role} response failed: json_parse_failed`);
    response = { ...config.fallback(), provider: 'claude' };
    debugReason = 'json_parse_failed';
  }

  // Always await the insert before returning a successful Claude call to the browser.
  const recorder = config.recordTrace ?? ((value, title, elapsed, session, metadata) =>
    recordAgentLlmTrace(config.role, value, title, elapsed, session, metadata));
  const traceRecorded = await recorder(
    llm,
    taskTitle,
    latencyMs,
    sessionId,
    config.traceMetadata?.(response),
  );

  return Response.json(withTelemetry(
    response,
    llm,
    latencyMs,
    traceRecorded,
    debugReason ?? llm.fallbackReason,
  ));
}
