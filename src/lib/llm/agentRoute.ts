import 'server-only';

import { getAgentRolePrompt } from '@/lib/agents/prompts';
import { claudeClient } from '@/lib/llm/claudeClient';
import { jsonString, jsonStrings, parseLlmJson } from '@/lib/llm/json';
import { mockClaude } from '@/lib/llm/mockClaude';
import { insertAgentTrace } from '@/lib/supabase/traces';
import type { AgentRole } from '@/types';

type FieldKind = 'string' | 'strings';
export interface AgentRouteConfig {
  role: Exclude<AgentRole, 'planner'>;
  fields: Record<string, FieldKind>;
  defaults: Record<string, string | string[]>;
  nextAgents: string[];
  enumFields?: Record<string, string[]>;
  instruction: string;
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 800) : fallback;
}

function mockPayload(config: AgentRouteConfig, summary?: string, telemetry?: { model?: string; latencyMs?: number; inputTokens?: number | null; outputTokens?: number | null }) {
  return {
    ok: true,
    provider: 'mock' as const,
    role: config.role,
    summary: summary ?? `${config.role}가 mock 모드에서 태스크를 검토했습니다.`,
    ...config.defaults,
    traceRecorded: false,
    model: telemetry?.model ?? 'mock-claude-v0',
    latencyMs: telemetry?.latencyMs ?? 0,
    inputTokens: telemetry?.inputTokens ?? 0,
    outputTokens: telemetry?.outputTokens ?? 0,
  };
}

export function createAgentPostHandler(config: AgentRouteConfig) {
  return async function POST(request: Request) {
    let body: Record<string, unknown>;
    try {
      body = await request.json() as Record<string, unknown>;
    } catch {
      return Response.json({ ...mockPayload(config), ok: false }, { status: 400 });
    }

    const taskTitle = text(body.taskTitle, `${config.role} task`);
    const taskDescription = text(body.taskDescription, 'Review this task and recommend the safest next step.');
    const sessionId = text(body.sessionId ?? body.session_id, '');
    const live = process.env.ENABLE_LIVE_LLM?.trim().toLowerCase() === 'true';
    const hasKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
    if (!live || !hasKey) {
      const mock = await mockClaude.complete({
        agentRole: config.role,
        messages: [{ role: 'user', content: `Task: ${taskTitle}\nDescription: ${taskDescription}` }],
        maxTokens: 260,
      });
      const payload = mockPayload(config, mock.content, mock);
      return Response.json(process.env.NODE_ENV === 'production' ? payload : {
        ...payload,
        debugReason: live ? 'missing_api_key' : 'live_disabled',
      });
    }

    const shape = Object.fromEntries([
      ['summary', 'string'],
      ...Object.entries(config.fields).map(([key, kind]) => [key, kind === 'strings' ? ['string'] : 'string']),
      ['nextAgent', config.nextAgents[0]],
    ]);
    const startedAt = Date.now();
    const llm = await claudeClient.complete({
      agentRole: config.role,
      systemPrompt: [
        getAgentRolePrompt(config.role).systemPrompt,
        config.instruction,
        'Return raw JSON only: no markdown, code fence, preface, or trailing explanation.',
        `Required shape: ${JSON.stringify(shape)}`,
        `nextAgent must be one of: ${config.nextAgents.join(', ')}.`,
      ].join('\n'),
      messages: [{ role: 'user', content: `Task title: ${taskTitle}\nTask description: ${taskDescription}\nReturn only JSON.` }],
      maxTokens: 320,
    });
    const latencyMs = Date.now() - startedAt;

    if (llm.provider !== 'claude') {
      const payload = mockPayload(config, llm.content, { ...llm, latencyMs });
      return Response.json(process.env.NODE_ENV === 'production' ? payload : { ...payload, debugReason: llm.fallbackReason });
    }

    const parsed = parseLlmJson(llm.content);
    if (!parsed) {
      console.warn(`Claude ${config.role} response failed: json_parse_failed`);
      const payload = mockPayload(config, 'Claude 응답을 JSON으로 파싱하지 못해 mock 결과로 대체했습니다.');
      return Response.json(process.env.NODE_ENV === 'production' ? payload : { ...payload, debugReason: 'json_parse_failed' });
    }

    const result: Record<string, unknown> = {
      ok: true,
      provider: 'claude',
      role: config.role,
      summary: jsonString(parsed.summary, `${config.role} 검토가 완료되었습니다.`),
    };
    for (const [key, kind] of Object.entries(config.fields)) {
      result[key] = kind === 'strings'
        ? jsonStrings(parsed[key], config.defaults[key] as string[])
        : jsonString(parsed[key], config.defaults[key] as string);
    }
    for (const [key, allowed] of Object.entries(config.enumFields ?? {})) {
      const fallback = config.defaults[key] as string;
      const candidate = jsonString(result[key], fallback).toLowerCase();
      result[key] = allowed.includes(candidate) ? candidate : fallback;
    }
    const candidate = jsonString(parsed.nextAgent, config.nextAgents[0]).toLowerCase();
    result.nextAgent = config.nextAgents.includes(candidate) ? candidate : config.nextAgents[0];

    const traceRecorded = await insertAgentTrace({
      sessionId: sessionId || undefined,
      agentId: config.role,
      traceType: 'llm_call',
      inputTokens: llm.inputTokens,
      outputTokens: llm.outputTokens,
      latencyMs,
      model: llm.model,
      metadata: { provider: 'claude', task_title: taskTitle },
    });

    return Response.json({
      ...result,
      traceRecorded,
      model: llm.model,
      latencyMs,
      inputTokens: llm.inputTokens,
      outputTokens: llm.outputTokens,
    });
  };
}
