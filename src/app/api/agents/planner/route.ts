import { getAgentRolePrompt } from '@/lib/agents/prompts';
import { claudeClient } from '@/lib/llm/claudeClient';
import { mockClaude } from '@/lib/llm/mockClaude';
import type { LlmResponse, PlannerAgentResponse } from '@/lib/llm/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PlannerRequestBody {
  taskTitle?: unknown;
  taskDescription?: unknown;
}

const ROLE = 'planner' as const;

function normalizeText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 600) : fallback;
}

function safePlannerResponse(
  patch: Partial<PlannerAgentResponse> = {},
): PlannerAgentResponse {
  return {
    ok: true,
    provider: 'mock',
    role: ROLE,
    summary: 'Planner가 mock 모드에서 스프린트 작업을 점검했습니다.',
    steps: [
      '요구사항을 작게 나누고 우선순위를 확인합니다.',
      'Architect에게 구현 경계와 데이터 흐름 검토를 넘깁니다.',
      'Developer/QA가 바로 착수할 수 있도록 완료 기준을 정리합니다.',
    ],
    risks: ['요구사항 범위가 넓으면 일정 추정이 흔들릴 수 있습니다.'],
    nextAgent: 'architect',
    ...patch,
  };
}

function withDevDebug(
  response: PlannerAgentResponse,
  debugReason?: string,
): PlannerAgentResponse {
  if (process.env.NODE_ENV === 'production' || !debugReason) return response;
  return { ...response, debugReason };
}

function arrayOfStrings(value: unknown, fallback: string[], allowEmpty = false): string[] {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 4);
  if (allowEmpty) return cleaned;
  return cleaned.length > 0 ? cleaned : fallback;
}

function stripMarkdownCodeFence(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}

function extractJsonObject(content: string): string {
  const unfenced = stripMarkdownCodeFence(content);
  const firstBrace = unfenced.indexOf('{');
  const lastBrace = unfenced.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return unfenced;
  }

  return unfenced.slice(firstBrace, lastBrace + 1);
}

function parsePlannerContent(llm: LlmResponse): { response: PlannerAgentResponse; debugReason?: string } {
  const fallback = safePlannerResponse({
    provider: llm.provider,
    summary: normalizeText(llm.content, 'Planner 응답을 JSON으로 파싱하지 못했습니다.'),
  });

  try {
    const parsed = JSON.parse(extractJsonObject(llm.content)) as Record<string, unknown>;
    const summary = normalizeText(parsed.summary, '');
    const steps = arrayOfStrings(parsed.steps, [], true);
    const risks = arrayOfStrings(parsed.risks, [], true).slice(0, 3);
    const nextAgent = normalizeText(parsed.nextAgent, '');

    if (!summary || steps.length === 0 || !nextAgent) {
      return { response: fallback, debugReason: 'json_parse_failed' };
    }

    return {
      response: safePlannerResponse({
        provider: llm.provider,
        summary,
        steps,
        risks,
        nextAgent: nextAgent.toLowerCase(),
      }),
    };
  } catch {
    return {
      response: fallback,
      debugReason: 'json_parse_failed',
    };
  }
}

function buildPlannerSystemPrompt(basePrompt: string): string {
  return [
    basePrompt,
    'You must return raw JSON only.',
    'Do not use markdown.',
    'Do not wrap the response in ```json fences.',
    'Do not add prose before or after the JSON object.',
    'The entire response must be parseable by JSON.parse.',
    'Use exactly this JSON object shape:',
    '{"summary":"string","steps":["string"],"risks":["string"],"nextAgent":"architect"}',
    'Use nextAgent="architect" unless the task is already fully planned.',
  ].join('\n');
}

function respondWithPlannerContent(llm: LlmResponse) {
  const parsed = parsePlannerContent(llm);
  return Response.json(withDevDebug(
    parsed.response,
    parsed.debugReason ?? llm.fallbackReason,
  ));
}

async function buildMockResponse(taskTitle: string, taskDescription: string): Promise<PlannerAgentResponse> {
  const mock = await mockClaude.complete({
    agentRole: ROLE,
    messages: [
      {
        role: 'user',
        content: `Task: ${taskTitle}\nDescription: ${taskDescription}`,
      },
    ],
    maxTokens: 220,
  });

  return safePlannerResponse({
    summary: mock.content,
    provider: 'mock',
  });
}

export async function POST(request: Request) {
  let body: PlannerRequestBody;

  try {
    body = await request.json() as PlannerRequestBody;
  } catch {
    return Response.json(
      safePlannerResponse({
        ok: false,
        summary: 'Invalid JSON body. Expected { taskTitle, taskDescription }.',
      }),
      { status: 400 },
    );
  }

  const taskTitle = normalizeText(body.taskTitle, 'Sprint planning');
  const taskDescription = normalizeText(
    body.taskDescription,
    'Review the current sprint and suggest the safest next handoff.',
  );

  const normalizedLiveFlag = process.env.ENABLE_LIVE_LLM?.trim().toLowerCase();
  const liveEnabled = normalizedLiveFlag === 'true';
  const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim());

  if (!liveEnabled) {
    return Response.json(withDevDebug(
      await buildMockResponse(taskTitle, taskDescription),
      `live_disabled:${normalizedLiveFlag ?? 'missing'}`,
    ));
  }

  if (!hasApiKey) {
    return Response.json(withDevDebug(
      await buildMockResponse(taskTitle, taskDescription),
      'missing_api_key',
    ));
  }

  const plannerPrompt = getAgentRolePrompt(ROLE);
  const llm = await claudeClient.complete({
    agentRole: ROLE,
    systemPrompt: buildPlannerSystemPrompt(plannerPrompt.systemPrompt),
    messages: [
      {
        role: 'user',
        content: [
          `Task title: ${taskTitle}`,
          `Task description: ${taskDescription}`,
          'Create a short planning summary, 2-4 execution steps, 0-3 risks, and the next agent.',
          'Return only the JSON object. No markdown. No code fences.',
        ].join('\n'),
      },
    ],
    maxTokens: 320,
  });

  return respondWithPlannerContent(llm);
}
