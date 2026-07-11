import { createAgentPost } from '@/lib/llm/agentRoute';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createAgentPost({
  role: 'qa',
  fields: { summary: 'string', testCases: 'array', regressionChecks: 'array', qualityRisks: 'array', finalStatus: 'string', nextAgent: 'string' },
  nextAgents: ['developer', 'reviewer', 'planner'],
  enumValues: { finalStatus: ['passed', 'failed', 'needs_more_testing'] },
  fallback: {
    summary: 'Mock QA 계획을 완료했습니다.',
    testCases: ['API mock fallback과 UI 이벤트 기록을 확인합니다.'],
    regressionChecks: ['Supabase LIVE, Realtime, sprint simulation을 재검증합니다.'],
    qualityRisks: ['Production 환경변수 누락 가능성이 있습니다.'],
    finalStatus: 'needs_more_testing',
    nextAgent: 'planner',
  },
  instruction: 'Provide test plan, test cases, regression checklist, quality risks, final status (passed|failed|needs_more_testing), and next agent.',
});
