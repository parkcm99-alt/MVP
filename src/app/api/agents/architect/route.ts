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
import type { ArchitectAgentResponse, LlmResponse } from '@/lib/llm/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ArchitectRequestBody {
  taskTitle?: unknown;
  taskDescription?: unknown;
  sessionId?: unknown;
  session_id?: unknown;
  analysisMode?: unknown;
  mode?: unknown;
}

const ROLE = 'architect' as const;
const NEXT_AGENTS = ['developer', 'reviewer', 'qa'] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeText(value: unknown, fallback: string, maxLength = 700): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : fallback;
}

function normalizeSessionId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return UUID_PATTERN.test(normalized) ? normalized : undefined;
}

function normalizeNextAgent(value: unknown): ArchitectAgentResponse['nextAgent'] {
  if (typeof value !== 'string') return 'developer';
  const normalized = value.trim().toLowerCase();
  return NEXT_AGENTS.includes(normalized as ArchitectAgentResponse['nextAgent'])
    ? normalized as ArchitectAgentResponse['nextAgent']
    : 'developer';
}

function arrayOfStrings(value: unknown, fallback: string[], maxItems = 4): string[] {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
  return cleaned.length > 0 ? cleaned : fallback;
}

function safeArchitectResponse(
  patch: Partial<ArchitectAgentResponse> = {},
  analysisMode: RequestAnalysisMode = 'business',
): ArchitectAgentResponse {
  const defaults = analysisMode === 'software'
    ? {
      summary: 'Architect가 mock 모드에서 시스템 구조를 점검했습니다.',
      architectureNotes: [
        'UI, API route, Supabase persistence 경계를 분리해 유지합니다.',
        'Planner 외 에이전트는 아직 mock workflow를 유지합니다.',
      ],
      dataFlow: [
        'Task Queue → server route → Claude/mock response → Event Log/Supabase traces',
      ],
      risks: ['환경변수 또는 RLS 설정이 맞지 않으면 trace 조회가 실패할 수 있습니다.'],
    }
    : {
      summary: 'Architect가 사업/운영 구조와 고객 흐름을 정리했습니다.',
      architectureNotes: [
        '초기 고객군, 제공 가치, 운영 책임 범위를 작게 정의합니다.',
        '파일럿 운영 후 확장 가능한 파트너십과 자동화 구조를 설계합니다.',
      ],
      dataFlow: [
        '고객 문제 접수 → 가치 제안 검증 → 파일럿 운영 → 성과 측정 → 유료 전환',
      ],
      risks: ['초기 운영 체계와 고객 데이터 활용 범위가 불명확하면 확장성이 낮아질 수 있습니다.'],
    };

  return {
    ok: true,
    provider: 'mock',
    role: ROLE,
    analysisMode,
    ...defaults,
    nextAgent: 'developer',
    ...patch,
  };
}

function withDevDebug(
  response: ArchitectAgentResponse,
  debugReason?: string,
  traceRecorded?: boolean,
): ArchitectAgentResponse {
  const responseWithTrace = typeof traceRecorded === 'boolean'
    ? { ...response, traceRecorded }
    : response;

  if (process.env.NODE_ENV === 'production') return responseWithTrace;

  return {
    ...responseWithTrace,
    ...(debugReason ? { debugReason } : {}),
  };
}

function withArchitectTelemetry(
  response: ArchitectAgentResponse,
  llm: LlmResponse,
  traceRecorded: boolean | undefined,
  latencyMs: number | null,
): ArchitectAgentResponse {
  return {
    ...response,
    traceRecorded: traceRecorded ?? response.traceRecorded ?? false,
    model: llm.model ?? null,
    latencyMs,
    inputTokens: llm.inputTokens ?? null,
    outputTokens: llm.outputTokens ?? null,
  };
}

function parseArchitectContent(
  llm: LlmResponse,
  analysisMode: RequestAnalysisMode,
): {
  response: ArchitectAgentResponse;
  debugReason?: string;
} {
  const fallback = safeArchitectResponse({
    provider: llm.provider,
    summary: analysisMode === 'business'
      ? 'Architect 응답 일부를 구조화하지 못해 운영 구조 기준으로 요약합니다.'
      : normalizeText(llm.content, 'Architect 응답을 JSON으로 파싱하지 못했습니다.'),
  }, analysisMode);

  try {
    const parsed = parseLlmJsonObject(llm.content);
    const summary = normalizeText(parsed.summary, '');

    if (!summary) {
      return { response: fallback, debugReason: 'json_parse_failed' };
    }

    return {
      response: safeArchitectResponse({
        provider: llm.provider,
        summary,
        architectureNotes: arrayOfStrings(parsed.architectureNotes, fallback.architectureNotes),
        dataFlow: arrayOfStrings(parsed.dataFlow, fallback.dataFlow),
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

function buildArchitectSystemPrompt(basePrompt: string, analysisMode: RequestAnalysisMode): string {
  return [
    basePrompt,
    `Analysis mode: ${describeRequestAnalysisMode(analysisMode)}.`,
    analysisMode === 'business'
      ? 'For business mode, architectureNotes must describe business/operating structure, customer flow, data or information flow, operating model, and scale path. Do not mention software frameworks or repository files.'
      : 'For software mode, architectureNotes may describe system structure, data flow, API/DB boundaries, and implementation risks.',
    'You must return raw JSON only.',
    'Do not use markdown.',
    'Do not wrap the response in ```json fences.',
    'Do not add prose before or after the JSON object.',
    'The entire response must be parseable by JSON.parse.',
    'Use exactly this JSON object shape:',
    '{"summary":"string","architectureNotes":["string"],"dataFlow":["string"],"risks":["string"],"nextAgent":"developer"}',
    'nextAgent must be exactly one of: developer, reviewer, qa.',
    analysisMode === 'business'
      ? 'Keep each array item concise and business/operations-oriented.'
      : 'Keep each array item concise and implementation-oriented.',
  ].join('\n');
}

function respondWithArchitectContent(
  llm: LlmResponse,
  analysisMode: RequestAnalysisMode,
  traceRecorded?: boolean,
  latencyMs: number | null = null,
) {
  const parsed = parseArchitectContent(llm, analysisMode);
  return Response.json(withDevDebug(
    withArchitectTelemetry(parsed.response, llm, traceRecorded, latencyMs),
    parsed.debugReason ?? llm.fallbackReason,
    traceRecorded,
  ));
}

async function recordArchitectLlmTrace(
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
    console.warn('[Supabase] architect llm_call trace failed: trace_insert_failed');
    return false;
  }
}

async function buildMockResponse(
  taskTitle: string,
  taskDescription: string,
  analysisMode: RequestAnalysisMode,
): Promise<ArchitectAgentResponse> {
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

  return safeArchitectResponse({
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
  let body: ArchitectRequestBody;

  try {
    body = await request.json() as ArchitectRequestBody;
  } catch {
    return Response.json(
      safeArchitectResponse({
        ok: false,
        summary: 'Invalid JSON body. Expected { taskTitle, taskDescription }.',
      }),
      { status: 400 },
    );
  }

  const taskTitle = normalizeText(body.taskTitle, 'Architecture review');
  const taskDescription = normalizeText(
    body.taskDescription,
    'Review the current task and produce architecture guidance before implementation.',
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

  const architectPrompt = getAgentRolePrompt(ROLE, analysisMode);
  const claudeStartedAt = Date.now();
  const llm = await claudeClient.complete({
    agentRole: ROLE,
    model: getModelForRole(ROLE),
    systemPrompt: buildArchitectSystemPrompt(architectPrompt.systemPrompt, analysisMode),
    messages: [
      {
        role: 'user',
        content: [
          `Analysis mode: ${describeRequestAnalysisMode(analysisMode)}`,
          `Task title: ${taskTitle}`,
          `Task description: ${taskDescription}`,
          'Create a concise architecture review for this task.',
          analysisMode === 'business'
            ? 'Include business/operating structure notes, customer flow, information flow, operating risks, and next agent recommendation.'
            : 'Include system structure notes, data flow, API/DB boundary concerns, implementation risks, and next agent recommendation.',
          'Return only the JSON object. No markdown. No code fences.',
        ].join('\n'),
      },
    ],
    maxTokens: 360,
  });
  const claudeLatencyMs = Date.now() - claudeStartedAt;

  const traceRecorded = await recordArchitectLlmTrace(llm, taskTitle, claudeLatencyMs, sessionId);

  return respondWithArchitectContent(llm, analysisMode, traceRecorded, claudeLatencyMs);
}
