import { handleAgentRequest } from '@/lib/llm/agentRoute';
import { enumField, stringList, textField } from '@/lib/llm/json';
import type { ReviewerAgentResponse } from '@/lib/llm/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fallback: ReviewerAgentResponse = {
  ok: true,
  provider: 'mock',
  role: 'reviewer',
  summary: '안전 fallback과 기존 동작 회귀 여부를 중심으로 검토합니다.',
  reviewFindings: ['입력 검증과 실패 경로를 확인해야 합니다.', '민감정보가 응답이나 로그에 노출되지 않아야 합니다.'],
  suggestedChanges: ['경계 조건 테스트를 추가하고 오류 메시지를 안전하게 유지하세요.'],
  risks: ['비동기 상태 경쟁과 Realtime 중복 반영 가능성이 있습니다.'],
  approvalStatus: 'needs_more_info',
  nextAgent: 'developer',
};

export async function POST(request: Request) {
  return handleAgentRequest(request, {
    role: 'reviewer',
    fallback,
    schema: '{"summary":"string","reviewFindings":["string"],"suggestedChanges":["string"],"risks":["string"],"approvalStatus":"approved|changes_requested|needs_more_info","nextAgent":"developer|qa"}',
    instruction: 'Review for bugs, regressions, security, performance, maintainability, and missing tests. State recommended changes and approval decision.',
    parse: (value, safe) => ({
      ...safe,
      summary: textField(value.summary, safe.summary),
      reviewFindings: stringList(value.reviewFindings, safe.reviewFindings, 5),
      suggestedChanges: stringList(value.suggestedChanges, safe.suggestedChanges, 5),
      risks: stringList(value.risks, safe.risks, 4),
      approvalStatus: enumField(value.approvalStatus, ['approved', 'changes_requested', 'needs_more_info'], safe.approvalStatus),
      nextAgent: enumField(value.nextAgent, ['developer', 'qa'], safe.nextAgent),
    }),
  });
}
