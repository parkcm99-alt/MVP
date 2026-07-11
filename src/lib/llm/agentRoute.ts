import 'server-only';

import { getAgentRolePrompt } from '@/lib/agents/prompts';
import { insertAgentTrace } from '@/lib/supabase/traces';
import type { AgentRole } from '@/types';
import { claudeClient } from './claudeClient';
import { parseLlmJson, stringArray, stringValue } from './json';

type ConnectedRole = Exclude<AgentRole, 'planner'>;

export interface AgentRouteConfig {
  role: ConnectedRole;
  fields: Record<string, 'string' | 'array'>;
  nextAgents: string[];
  enumValues?: Record<string, string[]>;
  fallback: Record<string, unknown>;
  instruction: string;
}

function normalize(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 1000) : fallback;
}

function normalizeSessionId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const id = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    ? id
    : undefined;
}

function debugFields(traceRecorded: boolean, model: string | null, latencyMs: number | null,
  inputTokens: number | null, outputTokens: number | null, debugReason?: string) {
  return {
    traceRecorded,
    model,
    latencyMs,
    inputTokens,
    outputTokens,
    ...(process.env.NODE_ENV !== 'production' && debugReason ? { debugReason } : {}),
  };
}

export function createAgentPost(config: AgentRouteConfig) {
  return async function POST(request: Request) {
    let body: Record<string, unknown>;
    try {
      body = await request.json() as Record<string, unknown>;
    } catch {
      return Response.json({ ok: false, provider: 'mock', role: config.role, ...config.fallback,
        ...debugFields(false, 'mock', 0, 0, 0, 'invalid_json') }, { status: 400 });
    }

    const taskTitle = normalize(body.taskTitle, `${config.role} task`);
    const taskDescription = normalize(body.taskDescription, 'Review the selected task.');
    const sessionId = normalizeSessionId(body.sessionId ?? body.session_id);
    const liveEnabled = process.env.ENABLE_LIVE_LLM?.trim().toLowerCase() === 'true';
    const hasKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim());

    if (!liveEnabled || !hasKey) {
      return Response.json({
        ok: true, provider: 'mock', role: config.role, ...config.fallback,
        ...debugFields(false, 'mock', 0, 0, 0, !liveEnabled ? 'live_disabled' : 'missing_api_key'),
      });
    }

    const shape = Object.fromEntries(Object.entries(config.fields).map(([key, kind]) => [
      key, kind === 'array' ? ['string'] : 'string',
    ]));
    const startedAt = Date.now();
    const llm = await claudeClient.complete({
      agentRole: config.role,
      systemPrompt: [
        getAgentRolePrompt(config.role).systemPrompt,
        config.instruction,
        'Return raw JSON only: no markdown, code fences, or surrounding explanation.',
        `Required shape: ${JSON.stringify(shape)}`,
      ].join('\n'),
      messages: [{ role: 'user', content: `Task title: ${taskTitle}\nTask description: ${taskDescription}` }],
      maxTokens: 320,
    });
    const latencyMs = Date.now() - startedAt;

    if (llm.provider !== 'claude') {
      return Response.json({
        ok: true, provider: 'mock', role: config.role, ...config.fallback,
        ...debugFields(false, llm.model, latencyMs, llm.inputTokens, llm.outputTokens, llm.fallbackReason),
      });
    }

    const traceRecorded = await insertAgentTrace({
      sessionId,
      agentId: config.role,
      traceType: 'llm_call',
      inputTokens: llm.inputTokens,
      outputTokens: llm.outputTokens,
      latencyMs,
      model: llm.model,
      metadata: { provider: 'claude', task_title: taskTitle },
    });

    const parsed = parseLlmJson(llm.content);
    if (!parsed) {
      console.warn(`Claude ${config.role} response failed: json_parse_failed`);
      return Response.json({
        ok: true, provider: 'claude', role: config.role, ...config.fallback,
        ...debugFields(traceRecorded, llm.model, latencyMs, llm.inputTokens, llm.outputTokens, 'json_parse_failed'),
      });
    }

    const normalized: Record<string, unknown> = {};
    for (const [key, kind] of Object.entries(config.fields)) {
      normalized[key] = kind === 'array'
        ? stringArray(parsed[key], config.fallback[key] as string[])
        : stringValue(parsed[key], String(config.fallback[key] ?? ''));
    }
    const nextAgent = String(normalized.nextAgent ?? '');
    if (config.nextAgents.length && !config.nextAgents.includes(nextAgent)) {
      normalized.nextAgent = config.fallback.nextAgent;
    }
    for (const [field, allowed] of Object.entries(config.enumValues ?? {})) {
      if (!allowed.includes(String(normalized[field] ?? ''))) normalized[field] = config.fallback[field];
    }

    return Response.json({
      ok: true, provider: 'claude', role: config.role, ...normalized,
      ...debugFields(traceRecorded, llm.model, latencyMs, llm.inputTokens, llm.outputTokens),
    });
  };
}
