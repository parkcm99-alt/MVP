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

function parsePlannerContent(llm: LlmResponse): PlannerAgentResponse {
  try {
    const parsed = JSON.parse(llm.content) as Record<string, unknown>;
    const fallback = safePlannerResponse({ provider: llm.provider });

    return safePlannerResponse({
      provider: llm.provider,
      summary: normalizeText(parsed.summary, fallback.summary),
      steps: arrayOfStrings(parsed.steps, fallback.steps),
      risks: arrayOfStrings(parsed.risks, fallback.risks, true).slice(0, 3),
      nextAgent: normalizeText(parsed.nextAgent, fallback.nextAgent).toLowerCase(),
    });
  } catch {
    return safePlannerResponse({
      provider: llm.provider,
      summary: normalizeText(llm.content, 'Planner 응답을 정리하지 못해 mock summary로 대체했습니다.'),
    });
  }
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

  const liveEnabled = process.env.ENABLE_LIVE_LLM === 'true';
  const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim());

  if (!liveEnabled || !hasApiKey) {
    return Response.json(await buildMockResponse(taskTitle, taskDescription));
  }

  const plannerPrompt = getAgentRolePrompt(ROLE);
  const llm = await claudeClient.complete({
    agentRole: ROLE,
    systemPrompt: [
      plannerPrompt.systemPrompt,
      'Return only JSON that matches this exact shape:',
      '{"summary":"string","steps":["string"],"risks":["string"],"nextAgent":"architect"}',
      'Use nextAgent="architect" unless the task is already fully planned.',
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: [
          `Task title: ${taskTitle}`,
          `Task description: ${taskDescription}`,
          'Create a short planning summary, 2-4 execution steps, 0-3 risks, and the next agent.',
        ].join('\n'),
      },
    ],
    maxTokens: 450,
  });

  return Response.json(parsePlannerContent(llm));
}
