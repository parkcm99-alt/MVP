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
import type { LlmResponse, ReviewerAgentResponse } from '@/lib/llm/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ReviewerRequestBody {
  taskTitle?: unknown;
  taskDescription?: unknown;
  sessionId?: unknown;
  session_id?: unknown;
  analysisMode?: unknown;
  mode?: unknown;
}

const ROLE = 'reviewer' as const;
const NEXT_AGENTS = ['developer', 'qa'] as const;
const APPROVAL_STATUSES = ['approved', 'changes_requested', 'needs_more_info'] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeText(value: unknown, fallback: string, maxLength = 700): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : fallback;
}

function normalizeSessionId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return UUID_PATTERN.test(normalized) ? normalized : undefined;
}

function normalizeNextAgent(value: unknown): ReviewerAgentResponse['nextAgent'] {
  if (typeof value !== 'string') return 'developer';
  const normalized = value.trim().toLowerCase();
  return NEXT_AGENTS.includes(normalized as ReviewerAgentResponse['nextAgent'])
    ? normalized as ReviewerAgentResponse['nextAgent']
    : 'developer';
}

function normalizeApprovalStatus(value: unknown): ReviewerAgentResponse['approvalStatus'] {
  if (typeof value !== 'string') return 'needs_more_info';
  const normalized = value.trim().toLowerCase();
  return APPROVAL_STATUSES.includes(normalized as ReviewerAgentResponse['approvalStatus'])
    ? normalized as ReviewerAgentResponse['approvalStatus']
    : 'needs_more_info';
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

function safeReviewerResponse(
  patch: Partial<ReviewerAgentResponse> = {},
  analysisMode: RequestAnalysisMode = 'business',
): ReviewerAgentResponse {
  const defaults = analysisMode === 'software'
    ? {
      summary: 'Reviewer가 mock 모드에서 코드 리뷰 관점의 검토를 완료했습니다.',
      reviewFindings: [
        '핵심 흐름은 유지되지만 경계 조건과 실패 케이스 확인이 필요합니다.',
        'Supabase/Realtime 경로는 실패해도 UI가 멈추지 않아야 합니다.',
      ],
      suggestedChanges: [
        'API 응답 실패 시 사용자에게 안전한 fallback 메시지를 남깁니다.',
        '변경된 버튼 흐름에 대한 lint/build 검증을 유지합니다.',
      ],
      risks: ['테스트 없이 UI workflow를 확장하면 기존 mock loop와 충돌할 수 있습니다.'],
    }
    : {
      summary: 'Reviewer가 사업 리스크와 고객 관점의 우려사항을 검토했습니다.',
      reviewFindings: [
        '초기 고객의 지불 의사와 반복 사용 이유를 더 명확히 검증해야 합니다.',
        '광고비와 고객 획득 비용이 수익모델보다 빠르게 커질 수 있습니다.',
      ],
      suggestedChanges: [
        '파일럿 고객 기준, 성과 지표, 가격 실험 조건을 먼저 문서화합니다.',
        '법적/운영 리스크와 데이터 활용 동의 범위를 사전에 확인합니다.',
      ],
      risks: ['고객 확보 비용과 성과 측정 방식이 불명확하면 유료 전환 판단이 어려울 수 있습니다.'],
    };

  return {
    ok: true,
    provider: 'mock',
    role: ROLE,
    analysisMode,
    ...defaults,
    approvalStatus: 'needs_more_info',
    nextAgent: 'developer',
    ...patch,
  };
}

function withDevDebug(
  response: ReviewerAgentResponse,
  debugReason?: string,
  traceRecorded?: boolean,
): ReviewerAgentResponse {
  const responseWithTrace = typeof traceRecorded === 'boolean'
    ? { ...response, traceRecorded }
    : response;

  if (process.env.NODE_ENV === 'production') return responseWithTrace;

  return {
    ...responseWithTrace,
    ...(debugReason ? { debugReason } : {}),
  };
}

function withReviewerTelemetry(
  response: ReviewerAgentResponse,
  llm: LlmResponse,
  traceRecorded: boolean | undefined,
  latencyMs: number | null,
): ReviewerAgentResponse {
  return {
    ...response,
    traceRecorded: traceRecorded ?? response.traceRecorded ?? false,
    model: llm.model ?? null,
    latencyMs,
    inputTokens: llm.inputTokens ?? null,
    outputTokens: llm.outputTokens ?? null,
  };
}

function parseReviewerContent(
  llm: LlmResponse,
  analysisMode: RequestAnalysisMode,
): {
  response: ReviewerAgentResponse;
  debugReason?: string;
} {
  const fallback = safeReviewerResponse({
    provider: llm.provider,
    summary: analysisMode === 'business'
      ? 'Reviewer 응답 일부를 구조화하지 못해 사업 리스크 기준으로 요약합니다.'
      : normalizeText(llm.content, 'Reviewer 응답을 JSON으로 파싱하지 못했습니다.'),
  }, analysisMode);

  try {
    const parsed = parseLlmJsonObject(llm.content);
    const summary = normalizeText(parsed.summary, '');

    if (!summary) {
      return { response: fallback, debugReason: 'json_parse_failed' };
    }

    return {
      response: safeReviewerResponse({
        provider: llm.provider,
        summary,
        reviewFindings: arrayOfStrings(parsed.reviewFindings, fallback.reviewFindings),
        suggestedChanges: arrayOfStrings(parsed.suggestedChanges, fallback.suggestedChanges),
        risks: arrayOfStrings(parsed.risks, [], 3),
        approvalStatus: normalizeApprovalStatus(parsed.approvalStatus),
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

function buildReviewerSystemPrompt(basePrompt: string, analysisMode: RequestAnalysisMode): string {
  return [
    basePrompt,
    `Analysis mode: ${describeRequestAnalysisMode(analysisMode)}.`,
    analysisMode === 'business'
      ? 'For business mode, reviewFindings must cover business risks, customer objections, cost/CAC, legal/operational risk, missing evidence, and decision questions. suggestedChanges must be business/strategy improvements, not code changes.'
      : 'For software mode, reviewFindings and suggestedChanges may focus on code review, bugs, regressions, security, performance, maintainability, and tests.',
    'You must return raw JSON only.',
    'Do not use markdown.',
    'Do not wrap the response in ```json fences.',
    'Do not add prose before or after the JSON object.',
    'Do not output any text outside the JSON object.',
    'The entire response must be parseable by JSON.parse.',
    'Use exactly this JSON object shape:',
    '{"summary":"string","reviewFindings":["string"],"suggestedChanges":["string"],"risks":["string"],"approvalStatus":"changes_requested","nextAgent":"developer"}',
    'approvalStatus must be exactly one of: approved, changes_requested, needs_more_info.',
    'nextAgent must be exactly one of: developer, qa.',
    analysisMode === 'business'
      ? 'Keep each array item concise and business-review oriented.'
      : 'Keep each array item concise and code-review oriented.',
  ].join('\n');
}

function respondWithReviewerContent(
  llm: LlmResponse,
  analysisMode: RequestAnalysisMode,
  traceRecorded?: boolean,
  latencyMs: number | null = null,
) {
  const parsed = parseReviewerContent(llm, analysisMode);
  return Response.json(withDevDebug(
    withReviewerTelemetry(parsed.response, llm, traceRecorded, latencyMs),
    parsed.debugReason ?? llm.fallbackReason,
    traceRecorded,
  ));
}

async function recordReviewerLlmTrace(
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
    console.warn('[Supabase] reviewer llm_call trace failed: trace_insert_failed');
    return false;
  }
}

async function buildMockResponse(
  taskTitle: string,
  taskDescription: string,
  analysisMode: RequestAnalysisMode,
): Promise<ReviewerAgentResponse> {
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

  return safeReviewerResponse({
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
  let body: ReviewerRequestBody;

  try {
    body = await request.json() as ReviewerRequestBody;
  } catch {
    return Response.json(
      safeReviewerResponse({
        ok: false,
        summary: 'Invalid JSON body. Expected { taskTitle, taskDescription }.',
      }),
      { status: 400 },
    );
  }

  const taskTitle = normalizeText(body.taskTitle, 'Code review');
  const taskDescription = normalizeText(
    body.taskDescription,
    'Review the current task from a code review perspective.',
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

  const reviewerPrompt = getAgentRolePrompt(ROLE, analysisMode);
  const claudeStartedAt = Date.now();
  const llm = await claudeClient.complete({
    agentRole: ROLE,
    model: getModelForRole(ROLE),
    systemPrompt: buildReviewerSystemPrompt(reviewerPrompt.systemPrompt, analysisMode),
    messages: [
      {
        role: 'user',
        content: [
          `Analysis mode: ${describeRequestAnalysisMode(analysisMode)}`,
          `Task title: ${taskTitle}`,
          `Task description: ${taskDescription}`,
          analysisMode === 'business'
            ? 'Create a concise business review result for this task.'
            : 'Create a concise code review result for this task.',
          analysisMode === 'business'
            ? 'Include business risks, customer objections, cost/CAC concerns, legal/operational concerns, suggested improvements, approval status, and next agent recommendation.'
            : 'Include review findings, suggested changes, risks, approval status, and next agent recommendation.',
          'Return only the JSON object. No markdown. No code fences.',
        ].join('\n'),
      },
    ],
    maxTokens: 380,
  });
  const claudeLatencyMs = Date.now() - claudeStartedAt;

  const traceRecorded = await recordReviewerLlmTrace(llm, taskTitle, claudeLatencyMs, sessionId);

  return respondWithReviewerContent(llm, analysisMode, traceRecorded, claudeLatencyMs);
}
