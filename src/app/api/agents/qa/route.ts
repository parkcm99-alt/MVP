import { handleAgentRequest } from '@/lib/llm/agentRoute';
import { enumField, stringList, textField } from '@/lib/llm/json';
import type { QaAgentResponse } from '@/lib/llm/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fallback: QaAgentResponse = {
  ok: true,
  provider: 'mock',
  role: 'qa',
  summary: '핵심 경로와 mock fallback 회귀를 우선 검증합니다.',
  testCases: ['유효한 입력의 정상 응답을 확인합니다.', '잘못된 입력과 연결 실패를 확인합니다.'],
  regressionChecks: ['Task Queue, Event Log, Realtime, Debug Panel 동작을 확인합니다.'],
  qualityRisks: ['멀티 브라우저 상태 경쟁과 누락된 trace가 있을 수 있습니다.'],
  finalStatus: 'needs_more_testing',
  nextAgent: 'developer',
};

export async function POST(request: Request) {
  return handleAgentRequest(request, {
    role: 'qa',
    fallback,
    schema: '{"summary":"string","testCases":["string"],"regressionChecks":["string"],"qualityRisks":["string"],"finalStatus":"passed|failed|needs_more_testing","nextAgent":"developer|reviewer|planner"}',
    instruction: 'Produce practical test cases, a regression checklist, quality risks, a final verification status, and the best next owner when issues remain.',
    parse: (value, safe) => ({
      ...safe,
      summary: textField(value.summary, safe.summary),
      testCases: stringList(value.testCases, safe.testCases, 6),
      regressionChecks: stringList(value.regressionChecks, safe.regressionChecks, 6),
      qualityRisks: stringList(value.qualityRisks, safe.qualityRisks, 4),
      finalStatus: enumField(value.finalStatus, ['passed', 'failed', 'needs_more_testing'], safe.finalStatus),
      nextAgent: enumField(value.nextAgent, ['developer', 'reviewer', 'planner'], safe.nextAgent),
    }),
  });
}
