import { createAgentPost } from '@/lib/llm/agentRoute';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createAgentPost({
  role: 'developer',
  fields: { summary: 'string', implementationPlan: 'array', filesToChange: 'array', testPlan: 'array', risks: 'array', nextAgent: 'string' },
  nextAgents: ['reviewer', 'qa'],
  fallback: {
    summary: 'Mock 구현 계획을 준비했습니다.',
    implementationPlan: ['작은 변경 단위로 구현하고 기존 simulation을 유지합니다.'],
    filesToChange: ['관련 route, component, shared types'],
    testPlan: ['lint와 production build를 실행합니다.'],
    risks: ['Realtime 상태와 mock loop 충돌을 점검합니다.'],
    nextAgent: 'reviewer',
  },
  instruction: 'Provide implementation plan, likely files, API/state/component changes, test plan, risks, and next agent.',
});
