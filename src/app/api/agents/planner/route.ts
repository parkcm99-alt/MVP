import { handleAgentRequest, recordAgentLlmTrace } from '@/lib/llm/agentRoute';
import { enumField, stringList, textField } from '@/lib/llm/json';
import type { AgentApiResponse, LlmResponse, PlannerAgentResponse } from '@/lib/llm/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fallback: PlannerAgentResponse = {
  ok: true,
  provider: 'mock',
  role: 'planner',
  summary: 'Planner가 mock 모드에서 스프린트 작업을 점검했습니다.',
  steps: [
    '요구사항과 우선순위를 정리합니다.',
    'Architect에게 구현 경계와 데이터 흐름 검토를 넘깁니다.',
    'Developer/QA가 구현과 검증 준비를 진행합니다.',
  ],
  risks: ['범위가 넓으면 일정 추정이 흔들릴 수 있습니다.'],
  nextAgent: 'architect',
};

// Keep this named wrapper visible: Planner telemetry is a production-critical await point.
async function recordPlannerLlmTrace(
  llm: LlmResponse,
  taskTitle: string,
  latencyMs: number,
  sessionId: string | undefined,
  outcome: AgentApiResponse,
): Promise<boolean> {
  return recordAgentLlmTrace('planner', llm, taskTitle, latencyMs, sessionId, outcome);
}

export async function POST(request: Request) {
  return handleAgentRequest(request, {
    role: 'planner',
    fallback,
    schema: '{"summary":"string","steps":["string"],"risks":["string"],"nextAgent":"architect|developer|reviewer|qa|planner"}',
    instruction: 'Create a short plan with 2-4 actionable steps, up to 3 risks, and the safest next agent.',
    parse: (value, safe) => ({
      ...safe,
      summary: textField(value.summary, safe.summary),
      steps: stringList(value.steps, safe.steps, 4),
      risks: stringList(value.risks, safe.risks, 3),
      nextAgent: enumField(value.nextAgent, ['architect', 'developer', 'reviewer', 'qa', 'planner'], safe.nextAgent),
    }),
  }, async (llm, taskTitle, latencyMs, sessionId, outcome) =>
    await recordPlannerLlmTrace(llm, taskTitle, latencyMs, sessionId, outcome));
}
