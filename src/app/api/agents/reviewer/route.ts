import { createAgentPostHandler } from '@/lib/llm/agentRoute';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = createAgentPostHandler({
  role: 'reviewer',
  fields: { summary: 'string', reviewFindings: 'strings', suggestedChanges: 'strings', risks: 'strings', approvalStatus: 'string' },
  defaults: {
    summary: 'Mock 코드 리뷰를 완료했습니다.',
    reviewFindings: ['서버 전용 key 경계와 fallback을 확인했습니다.'],
    suggestedChanges: ['lint와 production build를 통과시키세요.'],
    risks: ['RLS 및 환경변수 오설정을 확인하세요.'],
    approvalStatus: 'needs_more_info',
  },
  nextAgents: ['developer', 'qa'],
  prompt: 'Review for bugs, security, performance, maintainability, tests, suggested changes, approvalStatus (approved|changes_requested|needs_more_info), and next agent.',
});
