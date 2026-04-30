import { getAgentRolePrompt } from '@/lib/agents/prompts';
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
): ReviewerAgentResponse {
  return {
    ok: true,
    provider: 'mock',
    role: ROLE,
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

function parseReviewerContent(llm: LlmResponse): {
  response: ReviewerAgentResponse;
  debugReason?: string;
} {
  const fallback = safeReviewerResponse({
    provider: llm.provider,
    summary: normalizeText(llm.content, 'Reviewer 응답을 JSON으로 파싱하지 못했습니다.'),
  });

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
      }),
    };
  } catch {
    return {
      response: fallback,
      debugReason: 'json_parse_failed',
    };
  }
}

function buildReviewerSystemPrompt(basePrompt: string): string {
  return [
    basePrompt,
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
    'Keep each array item concise and code-review oriented.',
  ].join('\n');
}

function respondWithReviewerContent(
  llm: LlmResponse,
  traceRecorded?: boolean,
  latencyMs: number | null = null,
) {
  const parsed = parseReviewerContent(llm);
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
    summary: mock.content,
    provider: 'mock',
    traceRecorded: false,
    model: mock.model,
    latencyMs: mock.latencyMs,
    inputTokens: mock.inputTokens,
    outputTokens: mock.outputTokens,
  });
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

  const normalizedLiveFlag = process.env.ENABLE_LIVE_LLM?.trim().toLowerCase();
  const liveEnabled = normalizedLiveFlag === 'true';
  const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim());

  if (!liveEnabled) {
    return Response.json(withDevDebug(
      await buildMockResponse(taskTitle, taskDescription),
      `live_disabled:${normalizedLiveFlag ?? 'missing'}`,
      false,
    ));
  }

  if (!hasApiKey) {
    return Response.json(withDevDebug(
      await buildMockResponse(taskTitle, taskDescription),
      'missing_api_key',
      false,
    ));
  }

  const reviewerPrompt = getAgentRolePrompt(ROLE);
  const claudeStartedAt = Date.now();
  const llm = await claudeClient.complete({
    agentRole: ROLE,
    model: getModelForRole(ROLE),
    systemPrompt: buildReviewerSystemPrompt(reviewerPrompt.systemPrompt),
    messages: [
      {
        role: 'user',
        content: [
          `Task title: ${taskTitle}`,
          `Task description: ${taskDescription}`,
          'Create a concise code review result for this task.',
          'Include review findings, suggested changes, risks, approval status, and next agent recommendation.',
          'Return only the JSON object. No markdown. No code fences.',
        ].join('\n'),
      },
    ],
    maxTokens: 380,
  });
  const claudeLatencyMs = Date.now() - claudeStartedAt;

  const traceRecorded = await recordReviewerLlmTrace(llm, taskTitle, claudeLatencyMs, sessionId);

  return respondWithReviewerContent(llm, traceRecorded, claudeLatencyMs);
}
