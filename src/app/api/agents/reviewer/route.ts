import { createAgentPostHandler } from '@/lib/llm/agentRoute';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = createAgentPostHandler({
  role: 'reviewer',
  fields: { reviewFindings: 'strings', suggestedChanges: 'strings', risks: 'strings', approvalStatus: 'string' },
  defaults: {
    reviewFindings: ['오류 처리와 타입 안정성을 확인합니다.'],
    suggestedChanges: ['민감정보가 응답과 로그에 포함되지 않도록 유지합니다.'],
    risks: ['회귀 테스트 누락 가능성'],
    approvalStatus: 'needs_more_info',
    nextAgent: 'qa',
  },
  nextAgents: ['developer', 'qa'],
  enumFields: { approvalStatus: ['approved', 'changes_requested', 'needs_more_info'] },
  instruction: 'Review for bugs, security, performance, maintainability, recommended changes, approvalStatus (approved|changes_requested|needs_more_info), and next owner.',
});

export async function POST(request: Request) {
  return handler(request);
}
