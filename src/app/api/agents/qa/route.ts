import { createAgentPostHandler } from '@/lib/llm/agentRoute';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = createAgentPostHandler({
  role: 'qa',
  fields: { summary: 'string', testCases: 'strings', regressionChecks: 'strings', qualityRisks: 'strings', finalStatus: 'string' },
  defaults: {
    summary: 'Mock QA 계획을 완료했습니다.',
    testCases: ['mock/live gate와 응답 스키마를 검증합니다.'],
    regressionChecks: ['Supabase Realtime, Event Log, Task Queue를 확인합니다.'],
    qualityRisks: ['배포 환경변수 차이를 확인하세요.'],
    finalStatus: 'needs_more_testing',
  },
  nextAgents: ['developer', 'reviewer', 'planner'],
  prompt: 'Create test cases, regression checklist, quality risks, finalStatus (passed|failed|needs_more_testing), and next agent.',
});
