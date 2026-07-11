import { createAgentPostHandler } from '@/lib/llm/agentRoute';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = createAgentPostHandler({
  role: 'developer',
  fields: { implementationPlan: 'strings', filesToChange: 'strings', testPlan: 'strings', risks: 'strings' },
  defaults: {
    implementationPlan: ['작은 변경 단위로 구현하고 오류 fallback을 유지합니다.'],
    filesToChange: ['관련 API route와 UI component'],
    testPlan: ['lint, build, mock fallback을 검증합니다.'],
    risks: ['기존 realtime workflow 회귀 가능성'],
    nextAgent: 'reviewer',
  },
  nextAgents: ['reviewer', 'qa'],
  instruction: 'Provide an implementation plan, expected files, API/state/component changes, tests, risks, and next owner.',
});

export async function POST(request: Request) {
  return handler(request);
}
