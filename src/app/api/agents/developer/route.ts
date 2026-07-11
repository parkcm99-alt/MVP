import { createAgentPostHandler } from '@/lib/llm/agentRoute';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = createAgentPostHandler({
  role: 'developer',
  fields: { summary: 'string', implementationPlan: 'strings', filesToChange: 'strings', testPlan: 'strings', risks: 'strings' },
  defaults: {
    summary: 'Mock 구현 계획을 작성했습니다.',
    implementationPlan: ['작은 단위로 구현하고 기존 mock fallback을 보존합니다.'],
    filesToChange: ['관련 route와 UI component'],
    testPlan: ['lint, build, mock API 응답을 검증합니다.'],
    risks: ['기존 realtime workflow 회귀를 주의하세요.'],
  },
  nextAgents: ['reviewer', 'qa'],
  prompt: 'Produce an implementation plan, expected files, API/state/component changes, test plan, risks, and next agent.',
});
