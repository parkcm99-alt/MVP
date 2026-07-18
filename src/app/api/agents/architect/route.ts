import { handleAgentPost } from '@/lib/llm/agentRoute';
import { normalizeText, oneOf, strings } from '@/lib/llm/json';
import type { ArchitectAgentResponse } from '@/lib/llm/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fallback(summary = 'Architect가 mock 모드에서 시스템 경계를 검토했습니다.'): ArchitectAgentResponse {
  return {
    ok: true,
    provider: 'mock',
    role: 'architect',
    summary,
    architectureNotes: ['UI, 서버 Route Handler, Supabase persistence 경계를 분리합니다.', '실패해도 mock workflow가 이어지도록 합니다.'],
    dataFlow: ['Task Queue → 서버 API → 안전한 JSON 응답 → Event Log / trace'],
    risks: ['클라이언트에 서버 전용 환경변수가 노출되지 않도록 확인합니다.'],
    nextAgent: 'developer',
  };
}

export async function POST(request: Request) {
  return handleAgentPost(request, {
    role: 'architect',
    schema: '{"summary":"string","architectureNotes":["string"],"dataFlow":["string"],"risks":["string"],"nextAgent":"developer|reviewer|qa"}',
    instructions: 'Review system structure, data flow, API and database boundaries, implementation tradeoffs and risks. Recommend the next agent.',
    fallback,
    normalize: (parsed, provider) => {
      const safe = fallback();
      return {
        ...safe,
        provider,
        summary: normalizeText(parsed.summary, safe.summary),
        architectureNotes: strings(parsed.architectureNotes, safe.architectureNotes),
        dataFlow: strings(parsed.dataFlow, safe.dataFlow),
        risks: strings(parsed.risks, safe.risks, 4),
        nextAgent: oneOf(parsed.nextAgent, ['developer', 'reviewer', 'qa'] as const, 'developer'),
      };
    },
  });
}
