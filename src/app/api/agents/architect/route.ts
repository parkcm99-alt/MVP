import { createAgentPostHandler } from '@/lib/llm/agentRoute';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = createAgentPostHandler({
  role: 'architect',
  fields: { summary: 'string', architectureNotes: 'strings', dataFlow: 'strings', risks: 'strings' },
  defaults: {
    summary: 'Mock 설계 검토를 완료했습니다.',
    architectureNotes: ['Next.js server route와 client UI 경계를 유지합니다.'],
    dataFlow: ['UI → API route → provider/mock → Supabase trace'],
    risks: ['환경변수와 RLS 정책을 배포 전에 확인하세요.'],
  },
  nextAgents: ['developer', 'reviewer', 'qa'],
  prompt: 'Review system structure, data flow, API/DB boundaries, implementation risks, and recommend the next agent.',
});
