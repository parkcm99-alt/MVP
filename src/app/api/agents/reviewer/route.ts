import { handleAgentPost } from '@/lib/llm/agentRoute';
import { normalizeText, oneOf, strings } from '@/lib/llm/json';
import type { ReviewerAgentResponse } from '@/lib/llm/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fallback(summary = 'Reviewer가 mock 모드에서 코드 리뷰 관점을 정리했습니다.'): ReviewerAgentResponse {
  return {
    ok: true,
    provider: 'mock',
    role: 'reviewer',
    summary,
    reviewFindings: ['기존 Supabase/Realtime 경로와 mock fallback이 유지되는지 확인합니다.'],
    suggestedChanges: ['입력 검증과 안전한 오류 처리를 추가합니다.', '회귀 테스트 범위를 명시합니다.'],
    risks: ['민감정보가 응답, 로그, metadata에 포함되지 않아야 합니다.'],
    approvalStatus: 'needs_more_info',
    nextAgent: 'developer',
  };
}

export async function POST(request: Request) {
  return handleAgentPost(request, {
    role: 'reviewer',
    schema: '{"summary":"string","reviewFindings":["string"],"suggestedChanges":["string"],"risks":["string"],"approvalStatus":"approved|changes_requested|needs_more_info","nextAgent":"developer|qa"}',
    instructions: 'Think like a code reviewer: find bugs and regressions, assess security, performance and maintainability, recommend fixes, decide approval status, then hand off to developer or QA.',
    fallback,
    normalize: (parsed, provider) => {
      const safe = fallback();
      return {
        ...safe,
        provider,
        summary: normalizeText(parsed.summary, safe.summary),
        reviewFindings: strings(parsed.reviewFindings, safe.reviewFindings),
        suggestedChanges: strings(parsed.suggestedChanges, safe.suggestedChanges),
        risks: strings(parsed.risks, safe.risks, 4),
        approvalStatus: oneOf(parsed.approvalStatus, ['approved', 'changes_requested', 'needs_more_info'] as const, 'needs_more_info'),
        nextAgent: oneOf(parsed.nextAgent, ['developer', 'qa'] as const, 'developer'),
      };
    },
    traceMetadata: response => ({ approvalStatus: response.approvalStatus }),
  });
}
