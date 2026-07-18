import 'server-only';

import { getAgentRolePrompt } from '@/lib/agents/prompts';
import { insertAgentTrace } from '@/lib/supabase/traces';
import type { AgentRole } from '@/types';
import { claudeClient } from './claudeClient';
import { parseJsonObject, textField } from './json';
import { mockClaude } from './mockClaude';
import type { AgentApiResponse, LlmResponse } from './types';

interface AgentRequestBody {
  taskTitle?: unknown;
  taskDescription?: unknown;
  sessionId?: unknown;
  session_id?: unknown;
}

export type TraceRecorder = (
  llm: LlmResponse,
  taskTitle: string,
  latencyMs: number,
  sessionId: string | undefined,
  outcome: AgentApiResponse,
) => Promise<boolean>;

export interface AgentRouteConfig<R extends AgentApiResponse> {
  role: R['role'];
  fallback: R;
  schema: string;
  instruction: string;
  parse: (value: Record<string, unknown>, fallback: R) => R;
  maxTokens?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sessionField(value: unknown): string | undefined {
  return typeof value === 'string' && UUID.test(value.trim()) ? value.trim() : undefined;
}

function withDebug<R extends AgentApiResponse>(response: R, reason?: string): R {
  return process.env.NODE_ENV === 'production' || !reason
    ? response
    : { ...response, debugReason: reason };
}

function withTelemetry<R extends AgentApiResponse>(
  response: R,
  llm: LlmResponse,
  traceRecorded: boolean,
  latencyMs: number,
): R {
  return {
    ...response,
    traceRecorded,
    model: llm.model ?? null,
    latencyMs,
    inputTokens: llm.inputTokens ?? null,
    outputTokens: llm.outputTokens ?? null,
  };
}

function systemPrompt(role: AgentRole, schema: string): string {
  return [
    getAgentRolePrompt(role).systemPrompt,
    'Return one raw JSON object only. The whole response must be parseable by JSON.parse.',
    'Never use markdown, code fences, headings, comments, or explanation outside the object.',
    'Use concise Korean strings. Do not include secrets, credentials, or claims that you executed code.',
    `Use exactly this shape: ${schema}`,
  ].join('\n');
}

/** Shared server-side trace path for every live Claude role. */
export async function recordAgentLlmTrace(
  role: AgentRole,
  llm: LlmResponse,
  taskTitle: string,
  latencyMs: number,
  sessionId: string | undefined,
  outcome: AgentApiResponse,
): Promise<boolean> {
  if (llm.provider !== 'claude') return false;
  return insertAgentTrace({
    sessionId,
    agentId: role,
    traceType: 'llm_call',
    inputTokens: llm.inputTokens,
    outputTokens: llm.outputTokens,
    latencyMs,
    model: llm.model,
    metadata: {
      provider: 'claude',
      task_title: taskTitle,
      ...('approvalStatus' in outcome ? { approvalStatus: outcome.approvalStatus } : {}),
      ...('finalStatus' in outcome ? { finalStatus: outcome.finalStatus } : {}),
    },
  });
}

/** Cost-gated Route Handler implementation. No provider error or secret crosses this boundary. */
export async function handleAgentRequest<R extends AgentApiResponse>(
  request: Request,
  config: AgentRouteConfig<R>,
  traceRecorder?: TraceRecorder,
): Promise<Response> {
  let body: AgentRequestBody;
  try {
    body = await request.json() as AgentRequestBody;
  } catch {
    return Response.json({
      ...config.fallback,
      ok: false,
      summary: 'Invalid JSON body. Expected { taskTitle, taskDescription, sessionId }.',
    }, { status: 400 });
  }

  const taskTitle = textField(body.taskTitle, `${config.role} task`, 240);
  const taskDescription = textField(body.taskDescription, '현재 태스크를 안전하게 검토합니다.', 1200);
  const sessionId = sessionField(body.sessionId ?? body.session_id);
  const liveEnabled = process.env.ENABLE_LIVE_LLM?.trim().toLowerCase() === 'true';
  const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim());

  if (!liveEnabled || !hasApiKey) {
    const mock = await mockClaude.complete({
      agentRole: config.role,
      messages: [{ role: 'user', content: `Task: ${taskTitle}\nDescription: ${taskDescription}` }],
      maxTokens: config.maxTokens ?? 320,
    });
    return Response.json(withDebug(withTelemetry({
      ...config.fallback,
      provider: 'mock',
      summary: mock.content,
    }, mock, false, mock.latencyMs), liveEnabled ? 'missing_api_key' : 'live_disabled'));
  }

  const startedAt = Date.now();
  const llm = await claudeClient.complete({
    agentRole: config.role,
    systemPrompt: systemPrompt(config.role, config.schema),
    messages: [{
      role: 'user',
      content: [
        `Task title: ${taskTitle}`,
        `Task description: ${taskDescription}`,
        config.instruction,
        'Return only the JSON object. No markdown or code fences.',
      ].join('\n'),
    }],
    maxTokens: config.maxTokens ?? 320,
  });
  const latencyMs = Date.now() - startedAt;

  let outcome: R;
  let reason = llm.fallbackReason;
  if (llm.provider === 'claude') {
    const parsed = parseJsonObject(llm.content);
    if (parsed) {
      outcome = { ...config.parse(parsed, config.fallback), provider: 'claude' };
    } else {
      console.warn('Claude response fallback: json_parse_failed');
      reason = 'json_parse_failed';
      outcome = { ...config.fallback, provider: 'claude' };
    }
  } else {
    outcome = { ...config.fallback, provider: 'mock', summary: llm.content };
  }

  // Await the write before returning so the UI can trust traceRecorded.
  const traceRecorded = await (traceRecorder
    ? traceRecorder(llm, taskTitle, latencyMs, sessionId, outcome)
    : recordAgentLlmTrace(config.role, llm, taskTitle, latencyMs, sessionId, outcome));

  return Response.json(withDebug(withTelemetry(outcome, llm, traceRecorded, latencyMs), reason));
}
