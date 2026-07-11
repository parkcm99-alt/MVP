import { createAgentPost } from '@/lib/llm/agentRoute';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createAgentPost({
  role: 'reviewer',
  fields: { summary: 'string', reviewFindings: 'array', suggestedChanges: 'array', risks: 'array', approvalStatus: 'string', nextAgent: 'string' },
  nextAgents: ['developer', 'qa'],
  enumValues: { approvalStatus: ['approved', 'changes_requested', 'needs_more_info'] },
  fallback: {
    summary: 'Mock 코드 리뷰를 완료했습니다.',
    reviewFindings: ['서버/클라이언트 비밀 경계와 fallback을 확인했습니다.'],
    suggestedChanges: ['오류가 앱 흐름을 중단하지 않도록 유지합니다.'],
    risks: ['실환경 설정 차이를 배포 전에 재검증해야 합니다.'],
    approvalStatus: 'needs_more_info',
    nextAgent: 'qa',
  },
  instruction: 'Review for bugs, security, performance, maintainability, suggested changes, approval status (approved|changes_requested|needs_more_info), and next agent.',
});
