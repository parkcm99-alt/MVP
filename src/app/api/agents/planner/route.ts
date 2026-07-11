import { getAgentRolePrompt } from '@/lib/agents/prompts';
import {
  describeRequestAnalysisMode,
  normalizeRequestAnalysisMode,
  type RequestAnalysisMode,
} from '@/lib/agents/requestMode';
import { claudeClient } from '@/lib/llm/claudeClient';
import { parseLlmJsonObject } from '@/lib/llm/json';
import { mockClaude } from '@/lib/llm/mockClaude';
import { getModelForRole } from '@/lib/llm/modelSelector';
import { insertAgentTrace } from '@/lib/supabase/traces';
import type { LlmResponse, PlannerAgentResponse } from '@/lib/llm/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PlannerRequestBody {
  taskTitle?: unknown;
  taskDescription?: unknown;
  sessionId?: unknown;
  session_id?: unknown;
  analysisMode?: unknown;
  mode?: unknown;
}

const ROLE = 'planner' as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 600) : fallback;
}

function normalizeSessionId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return UUID_PATTERN.test(normalized) ? normalized : undefined;
}

function safePlannerResponse(
  patch: Partial<PlannerAgentResponse> = {},
  analysisMode: RequestAnalysisMode = 'business',
): PlannerAgentResponse {
  const defaults = analysisMode === 'software'
    ? {
      summary: 'Planner가 mock 모드에서 스프린트 작업을 점검했습니다.',
      steps: [
        '요구사항을 작게 나누고 우선순위를 확인합니다.',
        'Architect에게 구현 경계와 데이터 흐름 검토를 넘깁니다.',
        'Developer/QA가 바로 착수할 수 있도록 완료 기준을 정리합니다.',
      ],
      risks: ['요구사항 범위가 넓으면 일정 추정이 흔들릴 수 있습니다.'],
    }
    : {
      summary: 'Planner가 업무 목표와 핵심 이슈를 정리했습니다.',
      steps: [
        '핵심 고객과 해결할 문제를 먼저 정의합니다.',
        '수익모델과 파일럿 범위를 작게 검증합니다.',
        '운영 리스크와 다음 실행 액션을 우선순위로 정리합니다.',
      ],
      risks: ['초기 고객 가설과 가격 검증이 부족하면 실행 우선순위가 흔들릴 수 있습니다.'],
    };

  return {
    ok: true,
    provider: 'mock',
    role: ROLE,
    analysisMode,
    ...defaults,
    nextAgent: 'architect',
    ...patch,
  };
}

function withDevDebug(
  response: PlannerAgentResponse,
  debugReason?: string,
  traceRecorded?: boolean,
): PlannerAgentResponse {
  const responseWithTrace = typeof traceRecorded === 'boolean'
    ? { ...response, traceRecorded }
    : response;

  if (process.env.NODE_ENV === 'production') return responseWithTrace;

  return {
    ...responseWithTrace,
    ...(debugReason ? { debugReason } : {}),
  };
}

function withPlannerTelemetry(
  response: PlannerAgentResponse,
  llm: LlmResponse,
  traceRecorded: boolean | undefined,
  latencyMs: number | null,
): PlannerAgentResponse {
  return {
    ...response,
    traceRecorded: traceRecorded ?? response.traceRecorded ?? false,
    model: llm.model ?? null,
    latencyMs,
    inputTokens: llm.inputTokens ?? null,
    outputTokens: llm.outputTokens ?? null,
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

function parsePlannerContent(
  llm: LlmResponse,
  analysisMode: RequestAnalysisMode,
): { response: PlannerAgentResponse; debugReason?: string } {
  const fallback = safePlannerResponse({
    provider: llm.provider,
    summary: analysisMode === 'business'
      ? 'Planner 응답 일부를 구조화하지 못해 업무 목표 기준으로 요약합니다.'
      : normalizeText(llm.content, 'Planner 응답을 JSON으로 파싱하지 못했습니다.'),
  }, analysisMode);

  try {
    const parsed = parseLlmJsonObject(llm.content);
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
      }, analysisMode),
    };
  } catch {
    return {
      response: fallback,
      debugReason: 'json_parse_failed',
    };
  }
}

function buildPlannerSystemPrompt(basePrompt: string, analysisMode: RequestAnalysisMode): string {
  return [
    basePrompt,
    `Analysis mode: ${describeRequestAnalysisMode(analysisMode)}.`,
    analysisMode === 'business'
      ? 'For business mode, steps must be business execution steps, prioritization, customer validation, revenue/pilot planning, and operational risk checks. Avoid internal software implementation terms.'
      : 'For software mode, steps may be implementation tasks and technical handoffs.',
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

function respondWithPlannerContent(
  llm: LlmResponse,
  analysisMode: RequestAnalysisMode,
  traceRecorded?: boolean,
  latencyMs: number | null = null,
) {
  const parsed = parsePlannerContent(llm, analysisMode);
  return Response.json(withDevDebug(
    withPlannerTelemetry(parsed.response, llm, traceRecorded, latencyMs),
    parsed.debugReason ?? llm.fallbackReason,
    traceRecorded,
  ));
}

async function recordPlannerLlmTrace(
  llm: LlmResponse,
  taskTitle: string,
  latencyMs: number,
  sessionId?: string,
): Promise<boolean> {
  if (llm.provider !== 'claude') return false;

  try {
    const traceRecorded = await insertAgentTrace({
      sessionId,
      agentId: ROLE,
      traceType: 'llm_call',
      inputTokens: llm.inputTokens ?? null,
      outputTokens: llm.outputTokens ?? null,
      latencyMs,
      model: llm.model ?? null,
      metadata: {
        provider: 'claude',
        taskTitle,
      },
    });
    return traceRecorded;
  } catch {
    console.warn('[Supabase] planner llm_call trace failed: trace_insert_failed');
    return false;
  }
}

async function buildMockResponse(
  taskTitle: string,
  taskDescription: string,
  analysisMode: RequestAnalysisMode,
): Promise<PlannerAgentResponse> {
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
    ...(analysisMode === 'software' ? { summary: mock.content } : {}),
    provider: 'mock',
    traceRecorded: false,
    model: mock.model,
    latencyMs: mock.latencyMs,
    inputTokens: mock.inputTokens,
    outputTokens: mock.outputTokens,
  }, analysisMode);
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
  const sessionId = normalizeSessionId(body.sessionId ?? body.session_id);
  const analysisMode = normalizeRequestAnalysisMode(
    body.analysisMode ?? body.mode,
    taskTitle,
    taskDescription,
  );

  const normalizedLiveFlag = process.env.ENABLE_LIVE_LLM?.trim().toLowerCase();
  const liveEnabled = normalizedLiveFlag === 'true';
  const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim());

  if (!liveEnabled) {
    return Response.json(withDevDebug(
      await buildMockResponse(taskTitle, taskDescription, analysisMode),
      `live_disabled:${normalizedLiveFlag ?? 'missing'}`,
      false,
    ));
  }

  if (!hasApiKey) {
    return Response.json(withDevDebug(
      await buildMockResponse(taskTitle, taskDescription, analysisMode),
      'missing_api_key',
      false,
    ));
  }

  const plannerPrompt = getAgentRolePrompt(ROLE, analysisMode);
  const claudeStartedAt = Date.now();
  const llm = await claudeClient.complete({
    agentRole: ROLE,
    model: getModelForRole(ROLE),
    systemPrompt: buildPlannerSystemPrompt(plannerPrompt.systemPrompt, analysisMode),
    messages: [
      {
        role: 'user',
        content: [
          `Analysis mode: ${describeRequestAnalysisMode(analysisMode)}`,
          `Task title: ${taskTitle}`,
          `Task description: ${taskDescription}`,
          'Create a short planning summary, 2-4 execution steps, 0-3 risks, and the next agent.',
          'Return only the JSON object. No markdown. No code fences.',
        ].join('\n'),
      },
    ],
    maxTokens: 320,
  });
  const claudeLatencyMs = Date.now() - claudeStartedAt;

  const traceRecorded = await recordPlannerLlmTrace(llm, taskTitle, claudeLatencyMs, sessionId);

  return respondWithPlannerContent(llm, analysisMode, traceRecorded, claudeLatencyMs);
}
