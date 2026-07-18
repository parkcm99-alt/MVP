import 'server-only';

import { getAgentRolePrompt } from '@/lib/agents/prompts';
import { claudeClient } from '@/lib/llm/claudeClient';
import { arrayOfStrings, normalizeSessionId, normalizeText, parseJsonObject, stringEnum } from '@/lib/llm/json';
import { mockClaude } from '@/lib/llm/mockClaude';
import { insertAgentTrace } from '@/lib/supabase/traces';
import type {
  ArchitectAgentResponse,
  DeveloperAgentResponse,
  LlmProvider,
  LlmResponse,
  QaAgentResponse,
  ReviewerAgentResponse,
  StructuredAgentResponse,
} from '@/lib/llm/types';

type StructuredRole = StructuredAgentResponse['role'];
type Body = { taskTitle?: unknown; taskDescription?: unknown; sessionId?: unknown; session_id?: unknown };

interface RoleConfig<T extends StructuredAgentResponse> {
  role: T['role'];
  shape: string;
  instruction: string;
  fallback: (provider: LlmProvider, summary?: string) => T;
  parse: (parsed: Record<string, unknown>, provider: LlmProvider) => T;
}

const architectConfig: RoleConfig<ArchitectAgentResponse> = {
  role: 'architect',
  shape: '{"summary":"string","architectureNotes":["string"],"dataFlow":["string"],"risks":["string"],"nextAgent":"developer"}',
  instruction: 'Review system structure, data flow, API/database boundaries, implementation risks, and recommend developer, reviewer, or qa next.',
  fallback: (provider, summary = '시스템 경계와 데이터 흐름을 작은 단위로 검토했습니다.') => ({
    ok: true, provider, role: 'architect', summary,
    architectureNotes: ['UI와 서버 Route Handler 경계를 유지합니다.', 'Supabase persistence와 local-only 분석 상태를 분리합니다.'],
    dataFlow: ['브라우저 요청 → 서버 route → 안전한 구조화 응답', 'UI 상태 → Supabase persistence/Realtime'],
    risks: ['클라이언트에 서버 비밀값이 노출되지 않도록 경계를 점검해야 합니다.'],
    nextAgent: 'developer',
  }),
  parse: (p, provider) => ({
    ok: true, provider, role: 'architect',
    summary: normalizeText(p.summary, '설계 검토를 완료했습니다.'),
    architectureNotes: arrayOfStrings(p.architectureNotes, ['시스템 경계를 재확인합니다.']),
    dataFlow: arrayOfStrings(p.dataFlow, ['입력과 저장소 간 데이터 흐름을 확인합니다.']),
    risks: arrayOfStrings(p.risks, [], 4),
    nextAgent: stringEnum(p.nextAgent, ['developer', 'reviewer', 'qa'] as const, 'developer'),
  }),
};

const developerConfig: RoleConfig<DeveloperAgentResponse> = {
  role: 'developer',
  shape: '{"summary":"string","implementationPlan":["string"],"filesToChange":["string"],"testPlan":["string"],"risks":["string"],"nextAgent":"reviewer"}',
  instruction: 'Create an implementation plan, likely files, API/state/component change direction, test plan, risks, and recommend reviewer or qa next. Do not claim code was already changed.',
  fallback: (provider, summary = '작은 단위의 구현 계획과 검증 지점을 정리했습니다.') => ({
    ok: true, provider, role: 'developer', summary,
    implementationPlan: ['기존 동작을 유지하며 변경 범위를 분리합니다.', '입력 검증과 안전한 fallback을 먼저 구현합니다.'],
    filesToChange: ['src/components/', 'src/lib/'],
    testPlan: ['mock mode와 빈 상태를 확인합니다.', 'lint/build 및 회귀 동작을 확인합니다.'],
    risks: ['공유 상태 변경이 기존 Realtime 흐름에 영향을 줄 수 있습니다.'],
    nextAgent: 'reviewer',
  }),
  parse: (p, provider) => ({
    ok: true, provider, role: 'developer',
    summary: normalizeText(p.summary, '구현 계획을 정리했습니다.'),
    implementationPlan: arrayOfStrings(p.implementationPlan, ['변경을 작은 단계로 나눕니다.']),
    filesToChange: arrayOfStrings(p.filesToChange, ['관련 컴포넌트와 유틸리티']),
    testPlan: arrayOfStrings(p.testPlan, ['mock 및 회귀 동작을 확인합니다.']),
    risks: arrayOfStrings(p.risks, [], 4),
    nextAgent: stringEnum(p.nextAgent, ['reviewer', 'qa'] as const, 'reviewer'),
  }),
};

const reviewerConfig: RoleConfig<ReviewerAgentResponse> = {
  role: 'reviewer',
  shape: '{"summary":"string","reviewFindings":["string"],"suggestedChanges":["string"],"risks":["string"],"approvalStatus":"changes_requested","nextAgent":"developer"}',
  instruction: 'Review for potential bugs, security, performance, maintainability, missing tests, and actionable changes. Choose approved, changes_requested, or needs_more_info and recommend developer or qa.',
  fallback: (provider, summary = '코드 리뷰 관점에서 안전성과 회귀 가능성을 점검했습니다.') => ({
    ok: true, provider, role: 'reviewer', summary,
    reviewFindings: ['입력 검증과 실패 경로를 확인해야 합니다.'],
    suggestedChanges: ['민감정보 redaction 및 빈 상태 테스트를 추가합니다.'],
    risks: ['비동기 실패가 사용자에게 조용히 누락될 수 있습니다.'],
    approvalStatus: 'needs_more_info', nextAgent: 'developer',
  }),
  parse: (p, provider) => ({
    ok: true, provider, role: 'reviewer',
    summary: normalizeText(p.summary, '코드 리뷰를 완료했습니다.'),
    reviewFindings: arrayOfStrings(p.reviewFindings, ['주요 변경 경계를 확인합니다.']),
    suggestedChanges: arrayOfStrings(p.suggestedChanges, ['회귀 테스트를 확인합니다.']),
    risks: arrayOfStrings(p.risks, [], 4),
    approvalStatus: stringEnum(p.approvalStatus, ['approved', 'changes_requested', 'needs_more_info'] as const, 'needs_more_info'),
    nextAgent: stringEnum(p.nextAgent, ['developer', 'qa'] as const, 'developer'),
  }),
};

const qaConfig: RoleConfig<QaAgentResponse> = {
  role: 'qa',
  shape: '{"summary":"string","testCases":["string"],"regressionChecks":["string"],"qualityRisks":["string"],"finalStatus":"needs_more_testing","nextAgent":"developer"}',
  instruction: 'Create practical test cases, regression checklist, quality risks, and a final status of passed, failed, or needs_more_testing. Recommend developer or reviewer when issues remain, otherwise planner.',
  fallback: (provider, summary = '핵심 테스트와 회귀 검증 체크리스트를 준비했습니다.') => ({
    ok: true, provider, role: 'qa', summary,
    testCases: ['정상 입력과 빈 입력을 확인합니다.', '네트워크/Supabase 부재 fallback을 확인합니다.'],
    regressionChecks: ['Task Queue, Event Log, Realtime 동작을 확인합니다.'],
    qualityRisks: ['환경별 데이터와 권한 상태가 다를 수 있습니다.'],
    finalStatus: 'needs_more_testing', nextAgent: 'developer',
  }),
  parse: (p, provider) => ({
    ok: true, provider, role: 'qa',
    summary: normalizeText(p.summary, '테스트 계획을 완료했습니다.'),
    testCases: arrayOfStrings(p.testCases, ['핵심 사용자 흐름을 확인합니다.']),
    regressionChecks: arrayOfStrings(p.regressionChecks, ['기존 mock 흐름을 확인합니다.']),
    qualityRisks: arrayOfStrings(p.qualityRisks, [], 4),
    finalStatus: stringEnum(p.finalStatus, ['passed', 'failed', 'needs_more_testing'] as const, 'needs_more_testing'),
    nextAgent: stringEnum(p.nextAgent, ['developer', 'reviewer', 'planner'] as const, 'developer'),
  }),
};

const CONFIGS: { [K in StructuredRole]: RoleConfig<Extract<StructuredAgentResponse, { role: K }>> } = {
  architect: architectConfig,
  developer: developerConfig,
  reviewer: reviewerConfig,
  qa: qaConfig,
};

function withTelemetry<T extends StructuredAgentResponse>(
  response: T, llm: LlmResponse, traceRecorded: boolean, latencyMs: number | null, reason?: string,
): T {
  return {
    ...response,
    traceRecorded,
    model: llm.model ?? null,
    latencyMs,
    inputTokens: llm.inputTokens ?? null,
    outputTokens: llm.outputTokens ?? null,
    ...(process.env.NODE_ENV !== 'production' && reason ? { debugReason: reason } : {}),
  };
}

async function mockResponse<T extends StructuredAgentResponse>(config: RoleConfig<T>, taskTitle: string, taskDescription: string, reason: string): Promise<T> {
  const mock = await mockClaude.complete({
    agentRole: config.role,
    messages: [{ role: 'user', content: `Task: ${taskTitle}\nDescription: ${taskDescription}` }],
    maxTokens: 220,
  });
  return withTelemetry(config.fallback('mock', mock.content), mock, false, mock.latencyMs, reason);
}

async function recordAgentLlmTrace(
  role: StructuredRole, llm: LlmResponse, taskTitle: string, latencyMs: number,
  sessionId: string | undefined, response: StructuredAgentResponse,
): Promise<boolean> {
  if (llm.provider !== 'claude') return false;
  return insertAgentTrace({
    sessionId, agentId: role, traceType: 'llm_call',
    inputTokens: llm.inputTokens, outputTokens: llm.outputTokens,
    latencyMs, model: llm.model,
    metadata: {
      provider: 'claude', task_title: taskTitle,
      ...('approvalStatus' in response ? { approvalStatus: response.approvalStatus } : {}),
      ...('finalStatus' in response ? { finalStatus: response.finalStatus } : {}),
    },
  });
}

export async function handleStructuredAgentRequest(request: Request, role: StructuredRole): Promise<Response> {
  // A narrow cast keeps each public route/config independently typed.
  const config = CONFIGS[role] as RoleConfig<StructuredAgentResponse>;
  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return Response.json({ ...config.fallback('mock'), ok: false, summary: 'Invalid JSON body. Expected { taskTitle, taskDescription, sessionId }.' }, { status: 400 });
  }

  const taskTitle = normalizeText(body.taskTitle, `${role} task`);
  const taskDescription = normalizeText(body.taskDescription, 'Review the task safely and recommend the next handoff.');
  const sessionId = normalizeSessionId(body.sessionId ?? body.session_id);
  const live = process.env.ENABLE_LIVE_LLM?.trim().toLowerCase() === 'true';
  if (!live || !process.env.ANTHROPIC_API_KEY?.trim()) {
    return Response.json(await mockResponse(config, taskTitle, taskDescription, live ? 'missing_api_key' : 'live_disabled'));
  }

  const systemPrompt = [
    getAgentRolePrompt(role).systemPrompt,
    config.instruction,
    'Return raw JSON only. No markdown, no code fence, and no explanation before or after the object.',
    'The entire response must be parseable by JSON.parse and use this exact shape:',
    config.shape,
  ].join('\n');
  const startedAt = Date.now();
  const llm = await claudeClient.complete({
    agentRole: role, systemPrompt,
    messages: [{ role: 'user', content: `Task title: ${taskTitle}\nTask description: ${taskDescription}\nReturn only the JSON object.` }],
    maxTokens: 320,
  });
  const latencyMs = Date.now() - startedAt;

  if (llm.provider !== 'claude') {
    return Response.json(withTelemetry(config.fallback('mock', llm.content), llm, false, latencyMs, llm.fallbackReason));
  }

  const parsed = parseJsonObject(llm.content);
  const parseFailed = !parsed;
  if (parseFailed) console.warn(`Claude ${role} response failed: json_parse_failed`);
  const result = parsed ? config.parse(parsed, 'claude') : config.fallback('claude');
  // Await before responding: the caller can trust traceRecorded for this live call.
  const traceRecorded = await recordAgentLlmTrace(role, llm, taskTitle, latencyMs, sessionId, result);
  return Response.json(withTelemetry(result, llm, traceRecorded, latencyMs, parseFailed ? 'json_parse_failed' : llm.fallbackReason));
}
