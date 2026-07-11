import { createAgentPostHandler } from '@/lib/llm/agentRoute';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = createAgentPostHandler({
  role: 'architect',
  fields: { architectureNotes: 'strings', dataFlow: 'strings', risks: 'strings' },
  defaults: {
    architectureNotes: ['UI, API route, persistence 경계를 분리합니다.'],
    dataFlow: ['Task Queue → server route → safe result → Event Log'],
    risks: ['환경변수와 서버/클라이언트 경계를 확인해야 합니다.'],
    nextAgent: 'developer',
  },
  nextAgents: ['developer', 'reviewer', 'qa'],
  instruction: 'Review system structure, data flow, API/DB boundaries, implementation risks, and recommend the next owner.',
});

export async function POST(request: Request) {
  return handler(request);
}
