import 'server-only';

import { getAgentRolePrompt } from '@/lib/agents/prompts';
import { claudeClient } from '@/lib/llm/claudeClient';
import { mockClaude } from '@/lib/llm/mockClaude';
import { parseJsonObject, strings, text } from '@/lib/llm/json';
import { insertAgentTrace } from '@/lib/supabase/traces';
import type { AgentRole } from '@/types';

type SupportedRole = Exclude<AgentRole, 'planner'>;

interface RouteConfig {
  role: SupportedRole;
  shape: string;
  prompt: string;
  fallback: Record<string, unknown>;
  arrayFields: string[];
  enumFields: Record<string, string[]>;
}

interface Body { taskTitle?: unknown; taskDescription?: unknown; sessionId?: unknown; session_id?: unknown }

function normalized(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 800) : fallback;
}

function sanitizeResult(parsed: Record<string, unknown> | null, config: RouteConfig) {
  const result: Record<string, unknown> = { ...config.fallback };
  if (!parsed) return result;
  for (const key of Object.keys(config.fallback)) {
    if (config.arrayFields.includes(key)) result[key] = strings(parsed[key], result[key] as string[]);
    else if (config.enumFields[key]) {
      const candidate = text(parsed[key]).toLowerCase();
      if (config.enumFields[key].includes(candidate)) result[key] = candidate;
    } else result[key] = text(parsed[key], String(result[key] ?? ''));
  }
  return result;
}

export function createAgentPostHandler(config: RouteConfig) {
  return async function POST(request: Request) {
    let body: Body;
    try { body = await request.json() as Body; }
    catch { return Response.json({ ok: false, provider: 'mock', role: config.role, ...config.fallback }, { status: 400 }); }

    const taskTitle = normalized(body.taskTitle, `${config.role} task`);
    const taskDescription = normalized(body.taskDescription, 'Review the task and recommend the safest next action.');
    const sessionId = normalized(body.sessionId ?? body.session_id, '');
    const live = process.env.ENABLE_LIVE_LLM?.trim().toLowerCase() === 'true';
    const hasKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim());

    if (!live || !hasKey) {
      const mock = await mockClaude.complete({ agentRole: config.role, messages: [{ role: 'user', content: taskTitle }], maxTokens: 260 });
      return Response.json({ ok: true, provider: 'mock', role: config.role, ...config.fallback,
        summary: mock.content, traceRecorded: false, model: mock.model, latencyMs: mock.latencyMs,
        inputTokens: mock.inputTokens, outputTokens: mock.outputTokens,
        ...(process.env.NODE_ENV !== 'production' ? { debugReason: !live ? 'live_disabled' : 'missing_api_key' } : {}) });
    }

    const startedAt = Date.now();
    const llm = await claudeClient.complete({
      agentRole: config.role,
      systemPrompt: [getAgentRolePrompt(config.role).systemPrompt, config.prompt,
        'Return raw JSON only. No markdown, code fences, or explanation.', `Exact shape: ${config.shape}`].join('\n'),
      messages: [{ role: 'user', content: `Task title: ${taskTitle}\nTask description: ${taskDescription}\nReturn only JSON.` }],
      maxTokens: 320,
    });
    const latencyMs = Date.now() - startedAt;
    const parsed = llm.provider === 'claude' ? parseJsonObject(llm.content) : null;
    const values = sanitizeResult(parsed, config);
    const traceRecorded = llm.provider === 'claude' ? await insertAgentTrace({
      sessionId: sessionId || undefined, agentId: config.role, traceType: 'llm_call',
      inputTokens: llm.inputTokens, outputTokens: llm.outputTokens, latencyMs,
      model: llm.model, metadata: { provider: 'claude', task_title: taskTitle },
    }) : false;
    if (llm.provider === 'claude' && !parsed) console.warn(`Claude ${config.role} response: json_parse_failed`);
    return Response.json({ ok: true, provider: llm.provider, role: config.role, ...values,
      traceRecorded, model: llm.model, latencyMs, inputTokens: llm.inputTokens, outputTokens: llm.outputTokens,
      ...(process.env.NODE_ENV !== 'production' && (!parsed || llm.fallbackReason)
        ? { debugReason: llm.fallbackReason ?? 'json_parse_failed' } : {}) });
  };
}
