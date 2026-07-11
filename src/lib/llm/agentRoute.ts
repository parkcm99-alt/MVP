import 'server-only';

import { getAgentRolePrompt } from '@/lib/agents/prompts';
import { claudeClient } from '@/lib/llm/claudeClient';
import { mockClaude } from '@/lib/llm/mockClaude';
import { jsonString, jsonStrings, parseLlmJson } from '@/lib/llm/json';
import { insertAgentTrace } from '@/lib/supabase/traces';
import type { AgentRole } from '@/types';

type SupportedRole = Exclude<AgentRole, 'planner'>;

interface RouteConfig {
  role: SupportedRole;
  fields: Record<string, 'string' | 'strings'>;
  defaults: Record<string, string | string[]>;
  nextAgents: string[];
  prompt: string;
}

function cleanText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 1000) : fallback;
}

function buildResult(config: RouteConfig, provider: 'mock' | 'claude', parsed?: Record<string, unknown>) {
  const result: Record<string, unknown> = {
    ok: true,
    provider,
    role: config.role,
  };
  for (const [field, kind] of Object.entries(config.fields)) {
    const fallback = config.defaults[field];
    result[field] = kind === 'strings'
      ? jsonStrings(parsed?.[field], Array.isArray(fallback) ? fallback : [String(fallback)])
      : jsonString(parsed?.[field], Array.isArray(fallback) ? fallback.join(' ') : String(fallback));
  }
  if (config.role === 'reviewer' && !['approved', 'changes_requested', 'needs_more_info'].includes(String(result.approvalStatus))) {
    result.approvalStatus = 'needs_more_info';
  }
  if (config.role === 'qa' && !['passed', 'failed', 'needs_more_testing'].includes(String(result.finalStatus))) {
    result.finalStatus = 'needs_more_testing';
  }
  const requestedNext = jsonString(parsed?.nextAgent, config.nextAgents[0]);
  result.nextAgent = config.nextAgents.includes(requestedNext) ? requestedNext : config.nextAgents[0];
  return result;
}

export function createAgentPostHandler(config: RouteConfig) {
  return async function POST(request: Request) {
    let body: Record<string, unknown>;
    try {
      body = await request.json() as Record<string, unknown>;
    } catch {
      return Response.json({ ...buildResult(config, 'mock'), ok: false }, { status: 400 });
    }

    const taskTitle = cleanText(body.taskTitle, `${config.role} task`);
    const taskDescription = cleanText(body.taskDescription, 'Review the task and recommend the safest next action.');
    const sessionId = cleanText(body.sessionId ?? body.session_id, '');
    const live = process.env.ENABLE_LIVE_LLM?.trim().toLowerCase() === 'true';
    const hasKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim());

    if (!live || !hasKey) {
      const mock = await mockClaude.complete({
        agentRole: config.role,
        messages: [{ role: 'user', content: `${taskTitle}\n${taskDescription}` }],
        maxTokens: 240,
      });
      return Response.json({
        ...buildResult(config, 'mock', { summary: mock.content }),
        traceRecorded: false,
        model: mock.model,
        latencyMs: mock.latencyMs,
        inputTokens: mock.inputTokens,
        outputTokens: mock.outputTokens,
        ...(process.env.NODE_ENV !== 'production' ? { debugReason: !live ? 'live_disabled' : 'missing_api_key' } : {}),
      });
    }

    const shape = Object.fromEntries([
      ...Object.entries(config.fields).map(([key, kind]) => [key, kind === 'strings' ? ['string'] : 'string']),
      ['nextAgent', config.nextAgents.join('|')],
    ]);
    const startedAt = Date.now();
    const llm = await claudeClient.complete({
      agentRole: config.role,
      systemPrompt: [
        getAgentRolePrompt(config.role).systemPrompt,
        config.prompt,
        'Return raw JSON only. No markdown, code fences, commentary, or text outside JSON.',
        `Required shape: ${JSON.stringify(shape)}`,
      ].join('\n'),
      messages: [{ role: 'user', content: `Task title: ${taskTitle}\nTask description: ${taskDescription}` }],
      maxTokens: 320,
    });
    const latencyMs = Date.now() - startedAt;

    if (llm.provider !== 'claude') {
      return Response.json({
        ...buildResult(config, 'mock', { summary: llm.content }),
        traceRecorded: false,
        model: llm.model,
        latencyMs,
        inputTokens: llm.inputTokens,
        outputTokens: llm.outputTokens,
        ...(process.env.NODE_ENV !== 'production' ? { debugReason: llm.fallbackReason ?? 'provider_fallback' } : {}),
      });
    }

    const parsed = parseLlmJson(llm.content);
    if (!parsed) console.warn(`Claude ${config.role} response: json_parse_failed`);
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
      ...buildResult(config, parsed ? 'claude' : 'mock', parsed ?? { summary: llm.content }),
      traceRecorded,
      model: llm.model,
      latencyMs,
      inputTokens: llm.inputTokens,
      outputTokens: llm.outputTokens,
      ...(process.env.NODE_ENV !== 'production' && !parsed ? { debugReason: 'json_parse_failed' } : {}),
    });
  };
}
