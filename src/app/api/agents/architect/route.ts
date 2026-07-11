import { createAgentPost } from '@/lib/llm/agentRoute';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createAgentPost({
  role: 'architect',
  fields: { summary: 'string', architectureNotes: 'array', dataFlow: 'array', risks: 'array', nextAgent: 'string' },
  nextAgents: ['developer', 'reviewer', 'qa'],
  fallback: {
    summary: 'Mock 설계 검토를 완료했습니다.',
    architectureNotes: ['UI, API route, persistence 경계를 분리합니다.'],
    dataFlow: ['Task Queue → server route → safe response → Event Log'],
    risks: ['환경변수와 서버 전용 키 경계를 확인해야 합니다.'],
    nextAgent: 'developer',
  },
  instruction: 'Review system structure, data flow, API/DB boundaries, implementation risks, and recommend the next agent.',
});
