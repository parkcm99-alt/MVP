import { getAgentRolePrompt } from '@/lib/agents/prompts';
import { claudeClient } from '@/lib/llm/claudeClient';
import { parseLlmJsonObject } from '@/lib/llm/json';
import { mockClaude } from '@/lib/llm/mockClaude';
import { insertAgentTrace } from '@/lib/supabase/traces';
import type { DeveloperAgentResponse, LlmResponse } from '@/lib/llm/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface DeveloperRequestBody {
  taskTitle?: unknown;
  taskDescription?: unknown;
  sessionId?: unknown;
  session_id?: unknown;
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
): DeveloperAgentResponse {
  return {
    ok: true,
    provider: 'mock',
    role: ROLE,
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

function parseDeveloperContent(llm: LlmResponse): {
  response: DeveloperAgentResponse;
  debugReason?: string;
} {
  const fallback = safeDeveloperResponse({
    provider: llm.provider,
    summary: normalizeText(llm.content, 'Developer 응답을 JSON으로 파싱하지 못했습니다.'),
  });

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
      }),
    };
  } catch {
    return {
      response: fallback,
      debugReason: 'json_parse_failed',
    };
  }
}

function buildDeveloperSystemPrompt(basePrompt: string): string {
  return [
    basePrompt,
    'You must return raw JSON only.',
    'Do not use markdown.',
    'Do not wrap the response in ```json fences.',
    'Do not add prose before or after the JSON object.',
    'The entire response must be parseable by JSON.parse.',
    'Use exactly this JSON object shape:',
    '{"summary":"string","implementationPlan":["string"],"filesToChange":["string"],"testPlan":["string"],"risks":["string"],"nextAgent":"reviewer"}',
    'nextAgent must be exactly one of: reviewer, qa.',
    'Keep each array item concise, concrete, and implementation-oriented.',
    'Describe likely files or modules, not fabricated completed changes.',
  ].join('\n');
}

function respondWithDeveloperContent(
  llm: LlmResponse,
  traceRecorded?: boolean,
  latencyMs: number | null = null,
) {
  const parsed = parseDeveloperContent(llm);
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

  const developerPrompt = getAgentRolePrompt(ROLE);
  const claudeStartedAt = Date.now();
  const llm = await claudeClient.complete({
    agentRole: ROLE,
    systemPrompt: buildDeveloperSystemPrompt(developerPrompt.systemPrompt),
    messages: [
      {
        role: 'user',
        content: [
          `Task title: ${taskTitle}`,
          `Task description: ${taskDescription}`,
          'Create a concise implementation plan for this task.',
          'Include API/state/component direction, likely files or modules, test points, risks, and next agent recommendation.',
          'Return only the JSON object. No markdown. No code fences.',
        ].join('\n'),
      },
    ],
    maxTokens: 380,
  });
  const claudeLatencyMs = Date.now() - claudeStartedAt;

  const traceRecorded = await recordDeveloperLlmTrace(llm, taskTitle, claudeLatencyMs, sessionId);

  return respondWithDeveloperContent(llm, traceRecorded, claudeLatencyMs);
}
