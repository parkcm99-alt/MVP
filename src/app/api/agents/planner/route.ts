import { handleAgentPost, recordAgentLlmTrace } from '@/lib/llm/agentRoute';
import { normalizeText, oneOf, strings } from '@/lib/llm/json';
import type { LlmResponse, PlannerAgentResponse } from '@/lib/llm/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROLE = 'planner' as const;

function fallback(summary = 'Planner가 mock 모드에서 스프린트 작업을 점검했습니다.'): PlannerAgentResponse {
  return {
    ok: true,
    provider: 'mock',
    role: ROLE,
    summary,
    steps: [
      '요구사항을 작게 나누고 우선순위를 확인합니다.',
      'Architect에게 구현 경계와 데이터 흐름 검토를 넘깁니다.',
      'Developer/QA가 바로 착수할 수 있도록 완료 기준을 정리합니다.',
    ],
    risks: ['요구사항 범위가 넓으면 일정 추정이 흔들릴 수 있습니다.'],
    nextAgent: 'architect',
  };
}

/** Kept explicit so Planner trace recording is easy to audit in the route. */
async function recordPlannerLlmTrace(
  llm: LlmResponse,
  taskTitle: string,
  latencyMs: number,
  sessionId?: string,
  metadata?: Record<string, unknown>,
): Promise<boolean> {
  return recordAgentLlmTrace(ROLE, llm, taskTitle, latencyMs, sessionId, metadata);
}

export async function POST(request: Request) {
  return handleAgentPost(request, {
    role: ROLE,
    schema: '{"summary":"string","steps":["string"],"risks":["string"],"nextAgent":"architect"}',
    instructions: 'Create a concise planning summary, 2-4 actionable steps, up to 3 risks, and a clear handoff.',
    fallback,
    normalize: (parsed, provider) => {
      const safe = fallback();
      return {
        ...safe,
        provider,
        summary: normalizeText(parsed.summary, safe.summary),
        steps: strings(parsed.steps, safe.steps, 4),
        risks: strings(parsed.risks, safe.risks, 3),
        nextAgent: oneOf(parsed.nextAgent, ['architect', 'developer', 'reviewer', 'qa', 'planner'] as const, 'architect'),
      };
    },
    // Definition + awaited invocation through the shared handler are intentionally explicit.
    recordTrace: (llm, title, latency, session, metadata) =>
      recordPlannerLlmTrace(llm, title, latency, session, metadata),
  });
}
