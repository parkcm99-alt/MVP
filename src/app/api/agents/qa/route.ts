import { createAgentPostHandler } from '@/lib/llm/agentRoute';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = createAgentPostHandler({
  role: 'qa',
  fields: { testCases: 'strings', regressionChecks: 'strings', qualityRisks: 'strings', finalStatus: 'string' },
  defaults: {
    testCases: ['정상 호출과 mock fallback을 검증합니다.'],
    regressionChecks: ['Supabase, Realtime, Event Log 흐름을 확인합니다.'],
    qualityRisks: ['브라우저 간 동기화 타이밍 차이'],
    finalStatus: 'needs_more_testing',
    nextAgent: 'developer',
  },
  nextAgents: ['developer', 'reviewer', 'planner'],
  enumFields: { finalStatus: ['passed', 'failed', 'needs_more_testing'] },
  instruction: 'Create test cases, regression checks, quality risks, finalStatus (passed|failed|needs_more_testing), and a recovery handoff.',
});

export async function POST(request: Request) {
  return handler(request);
}
