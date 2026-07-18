import 'server-only';

import { getAgentRolePrompt } from '@/lib/agents/prompts';
import { claudeClient } from '@/lib/llm/claudeClient';
import { arrayOfStrings, buildRawJsonPrompt, enumValue, normalizeText, normalizeUuid, parseJsonObject } from '@/lib/llm/json';
import { mockClaude } from '@/lib/llm/mockClaude';
import { insertAgentTrace } from '@/lib/supabase/traces';
import type {
  ArchitectAgentResponse,
  DeveloperAgentResponse,
  LlmResponse,
  QaAgentResponse,
  ReviewerAgentResponse,
  SpecialistAgentResponse,
  SpecialistAgentRole,
} from '@/lib/llm/types';

interface AgentRequestBody {
  taskTitle?: unknown;
  taskDescription?: unknown;
  sessionId?: unknown;
  session_id?: unknown;
  traceId?: unknown;
}

type Config<T extends SpecialistAgentResponse> = {
  role: T['role'];
  shape: string;
  instruction: string;
  defaults: T;
  normalize: (parsed: Record<string, unknown>, base: T) => T;
};

const architectConfig: Config<ArchitectAgentResponse> = {
  role: 'architect',
  shape: '{"summary":"string","architectureNotes":["string"],"dataFlow":["string"],"risks":["string"],"nextAgent":"developer"}',
  instruction: 'Review system structure, data flow, API/DB boundaries, implementation risks, and recommend Developer, Reviewer, or QA.',
  defaults: {
    ok: true, provider: 'mock', role: 'architect',
    summary: 'Architect가 mock 모드에서 시스템 경계를 검토했습니다.',
    architectureNotes: ['UI와 서버 route의 책임을 분리합니다.', 'Supabase 접근은 기존 persistence 경계를 유지합니다.'],
    dataFlow: ['Task Queue → 서버 API → 안전한 응답 → Event Log/trace'],
    risks: ['Realtime과 로컬 상태를 중복 갱신하지 않도록 주의합니다.'],
    nextAgent: 'developer',
  },
  normalize: (parsed, base) => ({
    ...base,
    summary: normalizeText(parsed.summary, base.summary),
    architectureNotes: arrayOfStrings(parsed.architectureNotes, base.architectureNotes),
    dataFlow: arrayOfStrings(parsed.dataFlow, base.dataFlow),
    risks: arrayOfStrings(parsed.risks, base.risks, 4),
    nextAgent: enumValue(parsed.nextAgent, ['developer', 'reviewer', 'qa'] as const, base.nextAgent),
  }),
};

const developerConfig: Config<DeveloperAgentResponse> = {
  role: 'developer',
  shape: '{"summary":"string","implementationPlan":["string"],"filesToChange":["string"],"testPlan":["string"],"risks":["string"],"nextAgent":"reviewer"}',
  instruction: 'Provide an implementation plan, likely files, API/state/component direction, test plan, risks, and recommend Reviewer or QA.',
  defaults: {
    ok: true, provider: 'mock', role: 'developer',
    summary: 'Developer가 mock 모드에서 작은 구현 계획을 준비했습니다.',
    implementationPlan: ['기존 데이터 흐름을 확인하고 작은 변경으로 나눕니다.', '실패 경로와 fallback을 먼저 보호합니다.'],
    filesToChange: ['src/components/', 'src/lib/'],
    testPlan: ['mock mode와 정상 요청을 확인합니다.', 'lint/build 및 회귀 동작을 검증합니다.'],
    risks: ['공유 상태 변경이 Realtime 중복을 만들 수 있습니다.'],
    nextAgent: 'reviewer',
  },
  normalize: (parsed, base) => ({
    ...base,
    summary: normalizeText(parsed.summary, base.summary),
    implementationPlan: arrayOfStrings(parsed.implementationPlan, base.implementationPlan),
    filesToChange: arrayOfStrings(parsed.filesToChange, base.filesToChange),
    testPlan: arrayOfStrings(parsed.testPlan, base.testPlan),
    risks: arrayOfStrings(parsed.risks, base.risks, 4),
    nextAgent: enumValue(parsed.nextAgent, ['reviewer', 'qa'] as const, base.nextAgent),
  }),
};

const reviewerConfig: Config<ReviewerAgentResponse> = {
  role: 'reviewer',
  shape: '{"summary":"string","reviewFindings":["string"],"suggestedChanges":["string"],"risks":["string"],"approvalStatus":"approved","nextAgent":"qa"}',
  instruction: 'Assess bugs, security, performance, maintainability, recommended changes, approval status, and route to Developer or QA.',
  defaults: {
    ok: true, provider: 'mock', role: 'reviewer',
    summary: 'Reviewer가 mock 모드에서 코드 리뷰 체크포인트를 정리했습니다.',
    reviewFindings: ['입력 검증과 오류 fallback 경로를 확인합니다.'],
    suggestedChanges: ['민감정보가 응답, 로그, metadata에 포함되지 않는지 다시 확인합니다.'],
    risks: ['경계 조건과 회귀 테스트가 부족할 수 있습니다.'],
    approvalStatus: 'needs_more_info',
    nextAgent: 'developer',
  },
  normalize: (parsed, base) => ({
    ...base,
    summary: normalizeText(parsed.summary, base.summary),
    reviewFindings: arrayOfStrings(parsed.reviewFindings, base.reviewFindings),
    suggestedChanges: arrayOfStrings(parsed.suggestedChanges, base.suggestedChanges),
    risks: arrayOfStrings(parsed.risks, base.risks, 4),
    approvalStatus: enumValue(parsed.approvalStatus, ['approved', 'changes_requested', 'needs_more_info'] as const, base.approvalStatus),
    nextAgent: enumValue(parsed.nextAgent, ['developer', 'qa'] as const, base.nextAgent),
  }),
};

const qaConfig: Config<QaAgentResponse> = {
  role: 'qa',
  shape: '{"summary":"string","testCases":["string"],"regressionChecks":["string"],"qualityRisks":["string"],"finalStatus":"needs_more_testing","nextAgent":"developer"}',
  instruction: 'Produce test cases, regression checks, quality risks, a final validation status, and route issues to Developer or Reviewer (Planner when complete).',
  defaults: {
    ok: true, provider: 'mock', role: 'qa',
    summary: 'QA가 mock 모드에서 검증 계획을 준비했습니다.',
    testCases: ['정상 입력과 빈 입력의 응답 shape를 확인합니다.', 'mock fallback에서도 UI가 계속 동작하는지 확인합니다.'],
    regressionChecks: ['Task Queue, Event Log, Realtime, Debug Panel을 다시 확인합니다.'],
    qualityRisks: ['비동기 요청과 상태 복구 타이밍을 추가 검증해야 합니다.'],
    finalStatus: 'needs_more_testing',
    nextAgent: 'developer',
  },
  normalize: (parsed, base) => ({
    ...base,
    summary: normalizeText(parsed.summary, base.summary),
    testCases: arrayOfStrings(parsed.testCases, base.testCases),
    regressionChecks: arrayOfStrings(parsed.regressionChecks, base.regressionChecks),
    qualityRisks: arrayOfStrings(parsed.qualityRisks, base.qualityRisks, 4),
    finalStatus: enumValue(parsed.finalStatus, ['passed', 'failed', 'needs_more_testing'] as const, base.finalStatus),
    nextAgent: enumValue(parsed.nextAgent, ['developer', 'reviewer', 'planner'] as const, base.nextAgent),
  }),
};

const CONFIGS = { architect: architectConfig, developer: developerConfig, reviewer: reviewerConfig, qa: qaConfig };

function debugResponse<T extends SpecialistAgentResponse>(response: T, reason?: string): T {
  return process.env.NODE_ENV !== 'production' && reason
    ? { ...response, debugReason: reason }
    : response;
}

async function structuredMock<T extends SpecialistAgentResponse>(
  config: Config<T>, taskTitle: string, taskDescription: string, reason?: string,
): Promise<T> {
  const mock = await mockClaude.complete({
    agentRole: config.role,
    messages: [{ role: 'user', content: `Task: ${taskTitle}\nDescription: ${taskDescription}` }],
    maxTokens: 220,
  });
  return debugResponse({
    ...config.defaults,
    summary: mock.content,
    traceRecorded: false,
    model: mock.model,
    latencyMs: mock.latencyMs,
    inputTokens: mock.inputTokens,
    outputTokens: mock.outputTokens,
  }, reason);
}

async function recordAgentLlmTrace(
  role: SpecialistAgentRole, llm: LlmResponse, taskTitle: string, latencyMs: number,
  response: SpecialistAgentResponse, sessionId?: string, traceId?: string,
): Promise<boolean> {
  if (llm.provider !== 'claude') return false;
  return insertAgentTrace({
    id: traceId,
    sessionId,
    agentId: role,
    traceType: 'llm_call',
    inputTokens: llm.inputTokens,
    outputTokens: llm.outputTokens,
    latencyMs,
    model: llm.model,
    metadata: {
      provider: 'claude',
      task_title: taskTitle,
      ...('approvalStatus' in response ? { approvalStatus: response.approvalStatus } : {}),
      ...('finalStatus' in response ? { finalStatus: response.finalStatus } : {}),
    },
  });
}

async function handle<T extends SpecialistAgentResponse>(request: Request, config: Config<T>): Promise<Response> {
  let body: AgentRequestBody;
  try {
    body = await request.json() as AgentRequestBody;
  } catch {
    return Response.json({ ...config.defaults, ok: false, summary: 'Invalid JSON body. Expected taskTitle and taskDescription.' }, { status: 400 });
  }

  const taskTitle = normalizeText(body.taskTitle, `${config.role} task`);
  const taskDescription = normalizeText(body.taskDescription, 'Review the task safely and recommend the next step.');
  const sessionId = normalizeUuid(body.sessionId ?? body.session_id);
  const traceId = normalizeUuid(body.traceId);
  const liveFlag = process.env.ENABLE_LIVE_LLM?.trim().toLowerCase();

  if (liveFlag !== 'true') return Response.json(await structuredMock(config, taskTitle, taskDescription, `live_disabled:${liveFlag ?? 'missing'}`));
  if (!process.env.ANTHROPIC_API_KEY?.trim()) return Response.json(await structuredMock(config, taskTitle, taskDescription, 'missing_api_key'));

  const startedAt = Date.now();
  const llm = await claudeClient.complete({
    agentRole: config.role,
    systemPrompt: buildRawJsonPrompt(getAgentRolePrompt(config.role).systemPrompt, config.shape),
    messages: [{
      role: 'user',
      content: [`Task title: ${taskTitle}`, `Task description: ${taskDescription}`, config.instruction, 'Return raw JSON only.'].join('\n'),
    }],
    maxTokens: 320,
  });
  const latencyMs = Date.now() - startedAt;

  // A failed provider request is already a safe mock; do not attempt to parse its prose.
  if (llm.provider !== 'claude') {
    return Response.json(debugResponse({
      ...config.defaults,
      summary: normalizeText(llm.content, config.defaults.summary),
      traceRecorded: false,
      model: llm.model,
      latencyMs,
      inputTokens: llm.inputTokens,
      outputTokens: llm.outputTokens,
    }, llm.fallbackReason));
  }

  const parsed = parseJsonObject(llm.content);
  if (!parsed) console.warn(`Claude request failed: json_parse_failed (${config.role})`);
  const base = { ...config.defaults, provider: 'claude' as const };
  const content = parsed ? config.normalize(parsed, base) : base;
  // Await the write before returning, so telemetry reflects the real insert result.
  const traceRecorded = await recordAgentLlmTrace(config.role, llm, taskTitle, latencyMs, content, sessionId, traceId);
  return Response.json(debugResponse({
    ...content,
    traceRecorded,
    model: llm.model,
    latencyMs,
    inputTokens: llm.inputTokens,
    outputTokens: llm.outputTokens,
  }, parsed ? llm.fallbackReason : 'json_parse_failed'));
}

export function handleSpecialistAgent(request: Request, role: SpecialistAgentRole): Promise<Response> {
  switch (role) {
    case 'architect': return handle(request, CONFIGS.architect);
    case 'developer': return handle(request, CONFIGS.developer);
    case 'reviewer': return handle(request, CONFIGS.reviewer);
    case 'qa': return handle(request, CONFIGS.qa);
  }
}
