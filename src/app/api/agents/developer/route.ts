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
import type { DeveloperAgentResponse, LlmResponse } from '@/lib/llm/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface DeveloperRequestBody {
  taskTitle?: unknown;
  taskDescription?: unknown;
  sessionId?: unknown;
  session_id?: unknown;
  analysisMode?: unknown;
  mode?: unknown;
}

const ROLE = 'developer' as const;
const NEXT_AGENTS = ['reviewer', 'qa'] as const;

function normalizeText(value: unknown, fallback: string, maxLength = 700): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : fallback;
}

function normalizeSessionId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeNextAgent(value: unknown): DeveloperAgentResponse['nextAgent'] {
  if (typeof value !== 'string') return 'reviewer';
  const normalized = value.trim().toLowerCase();
  return NEXT_AGENTS.includes(normalized as DeveloperAgentResponse['nextAgent'])
    ? normalized as DeveloperAgentResponse['nextAgent']
    : 'reviewer';
}

function arrayOfStrings(value: unknown, fallback: string[], maxItems = 5): string[] {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
  return cleaned.length > 0 ? cleaned : fallback;
}

function safeDeveloperResponse(
  patch: Partial<DeveloperAgentResponse> = {},
  analysisMode: RequestAnalysisMode = 'business',
): DeveloperAgentResponse {
  const defaults = analysisMode === 'software'
    ? {
      summary: 'Developer가 mock 모드에서 구현 방향을 정리했습니다.',
      implementationPlan: [
        '요구사항을 작은 UI/API 변경 단위로 나눕니다.',
        '상태 업데이트와 Supabase persistence 경로를 유지하며 구현합니다.',
      ],
      filesToChange: [
        'src/components/*',
        'src/lib/*',
        'src/store/*',
      ],
      testPlan: [
        'npm run lint',
        'npm run build',
        'Task Queue 버튼 클릭 후 Event Log와 Trace Viewer 갱신 확인',
      ],
      risks: ['기존 realtime sync와 mock workflow를 깨뜨리지 않도록 범위를 작게 유지해야 합니다.'],
    }
    : {
      summary: 'Developer가 자동화 가능 영역과 MVP 기능 우선순위를 정리했습니다.',
      implementationPlan: [
        '반복 업무와 고객 접점을 자동화 후보로 분류합니다.',
        '초기 파일럿에서 필요한 최소 기능과 운영 체크포인트를 정의합니다.',
      ],
      filesToChange: [
        '고객 제안 자료',
        '파일럿 운영 체크리스트',
        '성과 측정 템플릿',
      ],
      testPlan: [
        '초기 고객 3-5곳의 반응과 전환 의향을 확인합니다.',
        '구독료와 성과 기반 과금 모델을 소규모로 비교합니다.',
      ],
      risks: ['자동화 범위를 너무 넓게 잡으면 파일럿 비용과 운영 부담이 커질 수 있습니다.'],
    };

  return {
    ok: true,
    provider: 'mock',
    role: ROLE,
    analysisMode,
    ...defaults,
    nextAgent: 'reviewer',
    ...patch,
  };
}

function withDevDebug(
  response: DeveloperAgentResponse,
  debugReason?: string,
  traceRecorded?: boolean,
): DeveloperAgentResponse {
  const responseWithTrace = typeof traceRecorded === 'boolean'
    ? { ...response, traceRecorded }
    : response;

  if (process.env.NODE_ENV === 'production') return responseWithTrace;

  return {
    ...responseWithTrace,
    ...(debugReason ? { debugReason } : {}),
  };
}

function withDeveloperTelemetry(
  response: DeveloperAgentResponse,
  llm: LlmResponse,
  traceRecorded: boolean | undefined,
  latencyMs: number | null,
): DeveloperAgentResponse {
  return {
    ...response,
    traceRecorded: traceRecorded ?? response.traceRecorded ?? false,
    model: llm.model ?? null,
    latencyMs,
    inputTokens: llm.inputTokens ?? null,
    outputTokens: llm.outputTokens ?? null,
  };
}

function parseDeveloperContent(
  llm: LlmResponse,
  analysisMode: RequestAnalysisMode,
): {
  response: DeveloperAgentResponse;
  debugReason?: string;
} {
  const fallback = safeDeveloperResponse({
    provider: llm.provider,
    summary: analysisMode === 'business'
      ? 'Developer 응답 일부를 구조화하지 못해 자동화/MVP 우선순위 기준으로 요약합니다.'
      : normalizeText(llm.content, 'Developer 응답을 JSON으로 파싱하지 못했습니다.'),
  }, analysisMode);

  try {
    const parsed = parseLlmJsonObject(llm.content);
    const summary = normalizeText(parsed.summary, '');

    if (!summary) {
      return { response: fallback, debugReason: 'json_parse_failed' };
    }

    return {
      response: safeDeveloperResponse({
        provider: llm.provider,
        summary,
        implementationPlan: arrayOfStrings(parsed.implementationPlan, fallback.implementationPlan),
        filesToChange: arrayOfStrings(parsed.filesToChange, fallback.filesToChange),
        testPlan: arrayOfStrings(parsed.testPlan, fallback.testPlan),
        risks: arrayOfStrings(parsed.risks, [], 3),
        nextAgent: normalizeNextAgent(parsed.nextAgent),
      }, analysisMode),
    };
  } catch {
    return {
      response: fallback,
      debugReason: 'json_parse_failed',
    };
  }
}

function buildDeveloperSystemPrompt(basePrompt: string, analysisMode: RequestAnalysisMode): string {
  return [
    basePrompt,
    `Analysis mode: ${describeRequestAnalysisMode(analysisMode)}.`,
    analysisMode === 'business'
      ? 'For business mode, do not propose code implementation. implementationPlan means automation opportunities, MVP capability priorities, operating steps, and systemization plan. filesToChange means business artifacts/assets to prepare, not repository file paths. testPlan means pilot validation checks, not lint/build commands.'
      : 'For software mode, implementationPlan/filesToChange/testPlan may describe code modules, API/state/component work, and technical verification.',
    'You must return raw JSON only.',
    'Do not use markdown.',
    'Do not wrap the response in ```json fences.',
    'Do not add prose before or after the JSON object.',
    'The entire response must be parseable by JSON.parse.',
    'Use exactly this JSON object shape:',
    '{"summary":"string","implementationPlan":["string"],"filesToChange":["string"],"testPlan":["string"],"risks":["string"],"nextAgent":"reviewer"}',
    'nextAgent must be exactly one of: reviewer, qa.',
    analysisMode === 'business'
      ? 'Keep each array item concise, concrete, and business-automation oriented.'
      : 'Keep each array item concise, concrete, and implementation-oriented.',
    analysisMode === 'business'
      ? 'Do not include Next.js, Supabase, API route, src/components, src/lib, npm run lint, npm run build, mock workflow, or DB migration.'
      : 'Describe likely files or modules, not fabricated completed changes.',
  ].join('\n');
}

function respondWithDeveloperContent(
  llm: LlmResponse,
  analysisMode: RequestAnalysisMode,
  traceRecorded?: boolean,
  latencyMs: number | null = null,
) {
  const parsed = parseDeveloperContent(llm, analysisMode);
  return Response.json(withDevDebug(
    withDeveloperTelemetry(parsed.response, llm, traceRecorded, latencyMs),
    parsed.debugReason ?? llm.fallbackReason,
    traceRecorded,
  ));
}

async function recordDeveloperLlmTrace(
  llm: LlmResponse,
  taskTitle: string,
  latencyMs: number,
  sessionId?: string,
): Promise<boolean> {
  if (llm.provider !== 'claude') return false;

  try {
    return await insertAgentTrace({
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
  } catch {
    console.warn('[Supabase] developer llm_call trace failed: trace_insert_failed');
    return false;
  }
}

async function buildMockResponse(
  taskTitle: string,
  taskDescription: string,
  analysisMode: RequestAnalysisMode,
): Promise<DeveloperAgentResponse> {
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

  return safeDeveloperResponse({
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
  let body: DeveloperRequestBody;

  try {
    body = await request.json() as DeveloperRequestBody;
  } catch {
    return Response.json(
      safeDeveloperResponse({
        ok: false,
        summary: 'Invalid JSON body. Expected { taskTitle, taskDescription }.',
      }),
      { status: 400 },
    );
  }

  const taskTitle = normalizeText(body.taskTitle, 'Implementation planning');
  const taskDescription = normalizeText(
    body.taskDescription,
    'Review the current task and produce implementation guidance before coding.',
    1400,
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

  const developerPrompt = getAgentRolePrompt(ROLE, analysisMode);
  const claudeStartedAt = Date.now();
  const llm = await claudeClient.complete({
    agentRole: ROLE,
    model: getModelForRole(ROLE),
    systemPrompt: buildDeveloperSystemPrompt(developerPrompt.systemPrompt, analysisMode),
    messages: [
      {
        role: 'user',
        content: [
          `Analysis mode: ${describeRequestAnalysisMode(analysisMode)}`,
          `Task title: ${taskTitle}`,
          `Task description: ${taskDescription}`,
          analysisMode === 'business'
            ? 'Create a concise business automation and MVP execution plan for this task.'
            : 'Create a concise implementation plan for this task.',
          analysisMode === 'business'
            ? 'Include automation opportunities, needed capabilities, MVP priorities, pilot validation checks, risks, and next agent recommendation.'
            : 'Include API/state/component direction, likely files or modules, test points, risks, and next agent recommendation.',
          'Return only the JSON object. No markdown. No code fences.',
        ].join('\n'),
      },
    ],
    maxTokens: 380,
  });
  const claudeLatencyMs = Date.now() - claudeStartedAt;

  const traceRecorded = await recordDeveloperLlmTrace(llm, taskTitle, claudeLatencyMs, sessionId);

  return respondWithDeveloperContent(llm, analysisMode, traceRecorded, claudeLatencyMs);
}
