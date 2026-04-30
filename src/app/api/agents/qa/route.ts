import { getAgentRolePrompt } from '@/lib/agents/prompts';
import { claudeClient } from '@/lib/llm/claudeClient';
import { parseLlmJsonObject } from '@/lib/llm/json';
import { mockClaude } from '@/lib/llm/mockClaude';
import { getModelForRole } from '@/lib/llm/modelSelector';
import { insertAgentTrace } from '@/lib/supabase/traces';
import type { LlmResponse, QaAgentResponse } from '@/lib/llm/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface QaRequestBody {
  taskTitle?: unknown;
  taskDescription?: unknown;
  sessionId?: unknown;
  session_id?: unknown;
}

const ROLE = 'qa' as const;
const NEXT_AGENTS = ['developer', 'reviewer', 'planner'] as const;
const FINAL_STATUSES = ['passed', 'failed', 'needs_more_testing'] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeText(value: unknown, fallback: string, maxLength = 700): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : fallback;
}

function normalizeSessionId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return UUID_PATTERN.test(normalized) ? normalized : undefined;
}

function normalizeNextAgent(value: unknown): QaAgentResponse['nextAgent'] {
  if (typeof value !== 'string') return 'developer';
  const normalized = value.trim().toLowerCase();
  return NEXT_AGENTS.includes(normalized as QaAgentResponse['nextAgent'])
    ? normalized as QaAgentResponse['nextAgent']
    : 'developer';
}

function normalizeFinalStatus(value: unknown): QaAgentResponse['finalStatus'] {
  if (typeof value !== 'string') return 'needs_more_testing';
  const normalized = value.trim().toLowerCase();
  return FINAL_STATUSES.includes(normalized as QaAgentResponse['finalStatus'])
    ? normalized as QaAgentResponse['finalStatus']
    : 'needs_more_testing';
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

function safeQaResponse(
  patch: Partial<QaAgentResponse> = {},
): QaAgentResponse {
  return {
    ok: true,
    provider: 'mock',
    role: ROLE,
    summary: 'QA가 mock 모드에서 테스트 계획과 품질 리스크를 점검했습니다.',
    testCases: [
      '주요 사용자 흐름이 정상 완료되는지 확인합니다.',
      'API 실패나 지연이 있어도 UI가 멈추지 않는지 확인합니다.',
    ],
    regressionChecks: [
      '기존 Planner/Architect/Developer/Reviewer 버튼 동작을 다시 확인합니다.',
      'Event Log와 Agent Trace Viewer가 정상 갱신되는지 확인합니다.',
    ],
    qualityRisks: ['Supabase 또는 Claude 호출 실패 시 fallback 메시지가 누락될 수 있습니다.'],
    finalStatus: 'needs_more_testing',
    nextAgent: 'developer',
    ...patch,
  };
}

function withDevDebug(
  response: QaAgentResponse,
  debugReason?: string,
  traceRecorded?: boolean,
): QaAgentResponse {
  const responseWithTrace = typeof traceRecorded === 'boolean'
    ? { ...response, traceRecorded }
    : response;

  if (process.env.NODE_ENV === 'production' && debugReason !== 'json_parse_failed') {
    return responseWithTrace;
  }

  return {
    ...responseWithTrace,
    ...(debugReason ? { debugReason } : {}),
  };
}

function withQaTelemetry(
  response: QaAgentResponse,
  llm: LlmResponse,
  traceRecorded: boolean | undefined,
  latencyMs: number | null,
): QaAgentResponse {
  return {
    ...response,
    traceRecorded: traceRecorded ?? response.traceRecorded ?? false,
    model: llm.model ?? null,
    latencyMs,
    inputTokens: llm.inputTokens ?? null,
    outputTokens: llm.outputTokens ?? null,
  };
}

function looksLikeJsonPayload(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.startsWith('{') ||
    trimmed.startsWith('```') ||
    trimmed.startsWith('"{') ||
    trimmed.startsWith('"\\{') ||
    trimmed.startsWith('\\{')
  );
}

function unwrapNestedSummaryPayload(parsed: Record<string, unknown>): {
  parsed: Record<string, unknown>;
  failed: boolean;
} {
  if (typeof parsed.summary !== 'string' || !looksLikeJsonPayload(parsed.summary)) {
    return { parsed, failed: false };
  }

  try {
    return {
      parsed: {
        ...parsed,
        ...parseLlmJsonObject(parsed.summary),
      },
      failed: false,
    };
  } catch {
    return { parsed, failed: true };
  }
}

function parseQaContent(llm: LlmResponse): {
  response: QaAgentResponse;
  debugReason?: string;
} {
  const fallback = safeQaResponse({
    provider: llm.provider,
    summary: normalizeText(llm.content, 'QA 응답을 JSON으로 파싱하지 못했습니다.'),
  });

  try {
    const initialParsed = parseLlmJsonObject(llm.content);
    const nested = unwrapNestedSummaryPayload(initialParsed);

    if (nested.failed) {
      return { response: fallback, debugReason: 'json_parse_failed' };
    }

    const parsed = nested.parsed;
    const summary = normalizeText(parsed.summary, '');

    if (!summary) {
      return { response: fallback, debugReason: 'json_parse_failed' };
    }

    return {
      response: safeQaResponse({
        provider: llm.provider,
        summary,
        testCases: arrayOfStrings(parsed.testCases, fallback.testCases),
        regressionChecks: arrayOfStrings(parsed.regressionChecks, fallback.regressionChecks),
        qualityRisks: arrayOfStrings(parsed.qualityRisks, [], 3),
        finalStatus: normalizeFinalStatus(parsed.finalStatus),
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

function buildQaSystemPrompt(basePrompt: string): string {
  return [
    basePrompt,
    'You must return raw JSON only.',
    'Do not use markdown.',
    'Do not wrap the response in ```json fences.',
    'Do not add prose before or after the JSON object.',
    'Do not output any text outside the JSON object.',
    'Never return an escaped JSON string.',
    'Never place JSON inside the summary field.',
    'The entire response must be parseable by JSON.parse.',
    'The summary field must be a short human-readable sentence only.',
    'testCases, regressionChecks, and qualityRisks must be arrays of strings.',
    'Use exactly this JSON object shape:',
    '{"summary":"string","testCases":["string"],"regressionChecks":["string"],"qualityRisks":["string"],"finalStatus":"needs_more_testing","nextAgent":"developer"}',
    'finalStatus must be exactly one of: passed, failed, needs_more_testing.',
    'nextAgent must be exactly one of: developer, reviewer, planner.',
    'Keep each array item concise and QA-oriented.',
  ].join('\n');
}

function respondWithQaContent(
  llm: LlmResponse,
  traceRecorded?: boolean,
  latencyMs: number | null = null,
) {
  const parsed = parseQaContent(llm);
  return Response.json(withDevDebug(
    withQaTelemetry(parsed.response, llm, traceRecorded, latencyMs),
    parsed.debugReason ?? llm.fallbackReason,
    traceRecorded,
  ));
}

async function recordQaLlmTrace(
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
    console.warn('[Supabase] qa llm_call trace failed: trace_insert_failed');
    return false;
  }
}

async function buildMockResponse(
  taskTitle: string,
  taskDescription: string,
): Promise<QaAgentResponse> {
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

  return safeQaResponse({
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
  let body: QaRequestBody;

  try {
    body = await request.json() as QaRequestBody;
  } catch {
    return Response.json(
      safeQaResponse({
        ok: false,
        summary: 'Invalid JSON body. Expected { taskTitle, taskDescription }.',
      }),
      { status: 400 },
    );
  }

  const taskTitle = normalizeText(body.taskTitle, 'QA verification');
  const taskDescription = normalizeText(
    body.taskDescription,
    'Review the current task from a QA verification perspective.',
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

  const qaPrompt = getAgentRolePrompt(ROLE);
  const claudeStartedAt = Date.now();
  const llm = await claudeClient.complete({
    agentRole: ROLE,
    model: getModelForRole(ROLE),
    systemPrompt: buildQaSystemPrompt(qaPrompt.systemPrompt),
    messages: [
      {
        role: 'user',
        content: [
          `Task title: ${taskTitle}`,
          `Task description: ${taskDescription}`,
          'Create a concise QA verification result for this task.',
          'Include test cases, regression checks, quality risks, final status, and next agent recommendation.',
          'Return only the JSON object. No markdown. No code fences.',
          'summary must be a short plain sentence, not JSON and not an escaped JSON string.',
        ].join('\n'),
      },
    ],
    maxTokens: 620,
  });
  const claudeLatencyMs = Date.now() - claudeStartedAt;

  const traceRecorded = await recordQaLlmTrace(llm, taskTitle, claudeLatencyMs, sessionId);

  return respondWithQaContent(llm, traceRecorded, claudeLatencyMs);
}
