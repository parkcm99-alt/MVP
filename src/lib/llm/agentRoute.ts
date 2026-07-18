import 'server-only';

import { getAgentRolePrompt } from '@/lib/agents/prompts';
import { claudeClient } from '@/lib/llm/claudeClient';
import { cleanEnum, cleanStringArray, cleanText, parseJsonObject } from '@/lib/llm/json';
import { mockClaude } from '@/lib/llm/mockClaude';
import { insertAgentTrace } from '@/lib/supabase/traces';
import type { LlmResponse, SpecialistAgentResponse, SpecialistRole } from '@/lib/llm/types';

interface AgentRequestBody {
  taskTitle?: unknown;
  taskDescription?: unknown;
  sessionId?: unknown;
  session_id?: unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sessionId(value: unknown): string | undefined {
  return typeof value === 'string' && UUID.test(value.trim()) ? value.trim() : undefined;
}

function defaults(role: SpecialistRole): SpecialistAgentResponse {
  switch (role) {
    case 'architect':
      return {
        ok: true, provider: 'mock', role, summary: 'Architect가 mock 모드에서 시스템 경계를 검토했습니다.',
        architectureNotes: ['UI, 서버 Route Handler, Supabase 저장 계층을 분리합니다.', '기존 mock/realtime 경로를 유지합니다.'],
        dataFlow: ['Client → 서버 API → 안전한 응답', 'Client → Supabase events/tasks → Realtime'],
        risks: ['새 통합이 기존 상태 흐름과 충돌하지 않도록 경계를 확인합니다.'], nextAgent: 'developer',
      };
    case 'developer':
      return {
        ok: true, provider: 'mock', role, summary: 'Developer가 mock 모드에서 작은 구현 계획을 준비했습니다.',
        implementationPlan: ['기존 인터페이스를 재사용해 작은 단위로 변경합니다.', '실패 시 안전한 fallback을 유지합니다.'],
        filesToChange: ['src/components/panels/TaskQueue.tsx', 'src/lib/llm/types.ts'],
        testPlan: ['mock 경로를 확인합니다.', 'lint와 production build를 실행합니다.'],
        risks: ['상태 업데이트의 중복과 회귀를 주의합니다.'], nextAgent: 'reviewer',
      };
    case 'reviewer':
      return {
        ok: true, provider: 'mock', role, summary: 'Reviewer가 mock 모드에서 변경 범위를 검토했습니다.',
        reviewFindings: ['서버 전용 비밀정보 경계를 유지해야 합니다.', '실패 경로가 UI를 멈추지 않는지 확인합니다.'],
        suggestedChanges: ['입력과 응답을 정규화하고 회귀 테스트를 추가합니다.'],
        risks: ['민감정보 로그 노출과 비동기 상태 경쟁을 확인합니다.'], approvalStatus: 'needs_more_info', nextAgent: 'developer',
      };
    case 'qa':
      return {
        ok: true, provider: 'mock', role, summary: 'QA가 mock 모드에서 최종 검증 계획을 준비했습니다.',
        testCases: ['정상 요청과 잘못된 JSON 요청을 확인합니다.', 'mock fallback과 버튼 상태를 확인합니다.'],
        regressionChecks: ['Task Queue, Event Log, Realtime 및 Debug Panel을 확인합니다.'],
        qualityRisks: ['네트워크 오류나 데이터 누락 시 빈 화면이 되지 않아야 합니다.'],
        finalStatus: 'needs_more_testing', nextAgent: 'developer',
      };
  }
}

const SHAPES: Record<SpecialistRole, string> = {
  architect: '{"summary":"string","architectureNotes":["string"],"dataFlow":["string"],"risks":["string"],"nextAgent":"developer|reviewer|qa"}',
  developer: '{"summary":"string","implementationPlan":["string"],"filesToChange":["string"],"testPlan":["string"],"risks":["string"],"nextAgent":"reviewer|qa"}',
  reviewer: '{"summary":"string","reviewFindings":["string"],"suggestedChanges":["string"],"risks":["string"],"approvalStatus":"approved|changes_requested|needs_more_info","nextAgent":"developer|qa"}',
  qa: '{"summary":"string","testCases":["string"],"regressionChecks":["string"],"qualityRisks":["string"],"finalStatus":"passed|failed|needs_more_testing","nextAgent":"developer|reviewer|planner"}',
};

const ROLE_TASK: Record<SpecialistRole, string> = {
  architect: 'Review system structure, data flow, API/database boundaries, implementation risks, and recommend the next owner.',
  developer: 'Provide an implementation plan, likely files, API/state/component direction, tests, risks, and recommend the next owner. Do not claim code was written.',
  reviewer: 'Review for bugs, security, performance, maintainability, missing tests, suggested changes, approval status, and the next owner.',
  qa: 'Provide practical test cases, regression checklist, quality risks, final validation status, and the next owner when issues need follow-up.',
};

function parseResponse(role: SpecialistRole, llm: LlmResponse): { response: SpecialistAgentResponse; parseFailed: boolean } {
  const base = defaults(role);
  const parsed = parseJsonObject(llm.content);
  if (!parsed) {
    return {
      response: { ...base, provider: llm.provider, summary: cleanText(llm.content, base.summary, 600) },
      parseFailed: true,
    };
  }

  // A parseable object stays on the live path; missing individual fields use safe defaults.
  const summary = cleanText(parsed.summary, base.summary);
  switch (role) {
    case 'architect':
      if (base.role !== role) break;
      return { parseFailed: false, response: {
        ...base, provider: llm.provider, summary,
        architectureNotes: cleanStringArray(parsed.architectureNotes, base.architectureNotes),
        dataFlow: cleanStringArray(parsed.dataFlow, base.dataFlow), risks: cleanStringArray(parsed.risks, base.risks, 4),
        nextAgent: cleanEnum(parsed.nextAgent, ['developer', 'reviewer', 'qa'] as const, base.nextAgent),
      } };
    case 'developer':
      if (base.role !== role) break;
      return { parseFailed: false, response: {
        ...base, provider: llm.provider, summary,
        implementationPlan: cleanStringArray(parsed.implementationPlan, base.implementationPlan),
        filesToChange: cleanStringArray(parsed.filesToChange, base.filesToChange),
        testPlan: cleanStringArray(parsed.testPlan, base.testPlan), risks: cleanStringArray(parsed.risks, base.risks, 4),
        nextAgent: cleanEnum(parsed.nextAgent, ['reviewer', 'qa'] as const, base.nextAgent),
      } };
    case 'reviewer':
      if (base.role !== role) break;
      return { parseFailed: false, response: {
        ...base, provider: llm.provider, summary,
        reviewFindings: cleanStringArray(parsed.reviewFindings, base.reviewFindings),
        suggestedChanges: cleanStringArray(parsed.suggestedChanges, base.suggestedChanges),
        risks: cleanStringArray(parsed.risks, base.risks, 4),
        approvalStatus: cleanEnum(parsed.approvalStatus, ['approved', 'changes_requested', 'needs_more_info'] as const, base.approvalStatus),
        nextAgent: cleanEnum(parsed.nextAgent, ['developer', 'qa'] as const, base.nextAgent),
      } };
    case 'qa':
      if (base.role !== role) break;
      return { parseFailed: false, response: {
        ...base, provider: llm.provider, summary,
        testCases: cleanStringArray(parsed.testCases, base.testCases),
        regressionChecks: cleanStringArray(parsed.regressionChecks, base.regressionChecks),
        qualityRisks: cleanStringArray(parsed.qualityRisks, base.qualityRisks, 4),
        finalStatus: cleanEnum(parsed.finalStatus, ['passed', 'failed', 'needs_more_testing'] as const, base.finalStatus),
        nextAgent: cleanEnum(parsed.nextAgent, ['developer', 'reviewer', 'planner'] as const, base.nextAgent),
      } };
  }
  return { response: base, parseFailed: false };
}

function withDebug(response: SpecialistAgentResponse, llm: LlmResponse, latencyMs: number | null, traceRecorded: boolean, reason?: string): SpecialistAgentResponse {
  return {
    ...response, traceRecorded, model: llm.model ?? null, latencyMs,
    inputTokens: llm.inputTokens ?? null, outputTokens: llm.outputTokens ?? null,
    ...(process.env.NODE_ENV !== 'production' && reason ? { debugReason: reason } : {}),
  };
}

async function mockResponse(role: SpecialistRole, taskTitle: string, taskDescription: string, reason: string) {
  const llm = await mockClaude.complete({ agentRole: role, messages: [{ role: 'user', content: `${taskTitle}\n${taskDescription}` }], maxTokens: 220 });
  const response = { ...defaults(role), summary: llm.content } as SpecialistAgentResponse;
  return Response.json(withDebug(response, llm, llm.latencyMs, false, reason));
}

export async function handleSpecialistPost(request: Request, role: SpecialistRole): Promise<Response> {
  let body: AgentRequestBody;
  try {
    body = await request.json() as AgentRequestBody;
  } catch {
    return Response.json({ ...defaults(role), ok: false, summary: 'Invalid JSON body. Expected { taskTitle, taskDescription, sessionId }.' }, { status: 400 });
  }

  const taskTitle = cleanText(body.taskTitle, `${role} task`);
  const taskDescription = cleanText(body.taskDescription, 'Review this task safely and suggest the next step.');
  const requestSession = sessionId(body.sessionId ?? body.session_id);
  const liveFlag = process.env.ENABLE_LIVE_LLM?.trim().toLowerCase();
  if (liveFlag !== 'true') return mockResponse(role, taskTitle, taskDescription, `live_disabled:${liveFlag ?? 'missing'}`);
  if (!process.env.ANTHROPIC_API_KEY?.trim()) return mockResponse(role, taskTitle, taskDescription, 'missing_api_key');

  const startedAt = Date.now();
  const llm = await claudeClient.complete({
    agentRole: role,
    systemPrompt: [
      getAgentRolePrompt(role).systemPrompt, ROLE_TASK[role],
      'Return RAW JSON ONLY. No markdown, no ``` fences, no explanation before or after the object.',
      'The entire response MUST be parseable with JSON.parse. Use this exact shape:', SHAPES[role],
      'Keep arrays concise (2-5 items) and values safe for an operations UI.',
    ].join('\n'),
    messages: [{ role: 'user', content: `Task title: ${taskTitle}\nTask description: ${taskDescription}\nReturn only the JSON object.` }],
    maxTokens: 320,
  });
  const latencyMs = Date.now() - startedAt;

  if (llm.provider !== 'claude') {
    return Response.json(withDebug({ ...defaults(role), summary: llm.content } as SpecialistAgentResponse, llm, latencyMs, false, llm.fallbackReason));
  }

  const parsed = parseResponse(role, llm);
  if (parsed.parseFailed) console.warn(`Claude ${role} response warning: json_parse_failed`);
  const statusMetadata = parsed.response.role === 'reviewer'
    ? { approvalStatus: parsed.response.approvalStatus }
    : parsed.response.role === 'qa' ? { finalStatus: parsed.response.finalStatus } : {};
  // Await before returning so traceRecorded accurately reflects an attempted server insert.
  const traceRecorded = await insertAgentTrace({
    sessionId: requestSession, agentId: role, traceType: 'llm_call',
    inputTokens: llm.inputTokens, outputTokens: llm.outputTokens, latencyMs, model: llm.model,
    metadata: { provider: 'claude', task_title: taskTitle, ...statusMetadata },
  });
  return Response.json(withDebug(parsed.response, llm, latencyMs, traceRecorded, parsed.parseFailed ? 'json_parse_failed' : llm.fallbackReason));
}
