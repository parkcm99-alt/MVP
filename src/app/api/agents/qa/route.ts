import { handleAgentPost } from '@/lib/llm/agentRoute';
import { normalizeText, oneOf, strings } from '@/lib/llm/json';
import type { QaAgentResponse } from '@/lib/llm/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fallback(summary = 'QA가 mock 모드에서 테스트 계획을 준비했습니다.'): QaAgentResponse {
  return {
    ok: true,
    provider: 'mock',
    role: 'qa',
    summary,
    testCases: ['정상 요청에서 계약된 JSON shape를 확인합니다.', '잘못된 입력과 연결 실패 fallback을 확인합니다.'],
    regressionChecks: ['기존 Task Queue, Event Log, Realtime 동작 확인', 'lint 및 production build 확인'],
    qualityRisks: ['외부 연결이 없을 때 UI가 중단되지 않아야 합니다.'],
    finalStatus: 'needs_more_testing',
    nextAgent: 'developer',
  };
}

export async function POST(request: Request) {
  return handleAgentPost(request, {
    role: 'qa',
    schema: '{"summary":"string","testCases":["string"],"regressionChecks":["string"],"qualityRisks":["string"],"finalStatus":"passed|failed|needs_more_testing","nextAgent":"developer|reviewer|planner"}',
    instructions: 'Create practical test cases and regression checks, identify quality risks, decide final validation status, and send failures back to developer or reviewer when appropriate.',
    fallback,
    normalize: (parsed, provider) => {
      const safe = fallback();
      return {
        ...safe,
        provider,
        summary: normalizeText(parsed.summary, safe.summary),
        testCases: strings(parsed.testCases, safe.testCases),
        regressionChecks: strings(parsed.regressionChecks, safe.regressionChecks),
        qualityRisks: strings(parsed.qualityRisks, safe.qualityRisks, 4),
        finalStatus: oneOf(parsed.finalStatus, ['passed', 'failed', 'needs_more_testing'] as const, 'needs_more_testing'),
        nextAgent: oneOf(parsed.nextAgent, ['developer', 'reviewer', 'planner'] as const, 'developer'),
      };
    },
    traceMetadata: response => ({ finalStatus: response.finalStatus }),
  });
}
