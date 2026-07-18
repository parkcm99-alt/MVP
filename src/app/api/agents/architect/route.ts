import { handleAgentRequest } from '@/lib/llm/agentRoute';
import { enumField, stringList, textField } from '@/lib/llm/json';
import type { ArchitectAgentResponse } from '@/lib/llm/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fallback: ArchitectAgentResponse = {
  ok: true,
  provider: 'mock',
  role: 'architect',
  summary: '현재 구조를 작은 서버 경계와 클라이언트 상태로 분리하는 방향이 안전합니다.',
  architectureNotes: ['UI와 서버 Route Handler의 책임을 분리합니다.', 'Supabase 저장은 실패해도 UI를 차단하지 않습니다.'],
  dataFlow: ['Task Queue → server route → 구조 검토 결과', '결과 → Event Log 및 안전한 trace'],
  risks: ['클라이언트에 서버 비밀값이 섞이지 않도록 경계를 검토해야 합니다.'],
  nextAgent: 'developer',
};

export async function POST(request: Request) {
  return handleAgentRequest(request, {
    role: 'architect',
    fallback,
    schema: '{"summary":"string","architectureNotes":["string"],"dataFlow":["string"],"risks":["string"],"nextAgent":"developer|reviewer|qa"}',
    instruction: 'Review system structure, data flow, API/DB boundaries, implementation risks, and recommend the next owner.',
    parse: (value, safe) => ({
      ...safe,
      summary: textField(value.summary, safe.summary),
      architectureNotes: stringList(value.architectureNotes, safe.architectureNotes, 5),
      dataFlow: stringList(value.dataFlow, safe.dataFlow, 5),
      risks: stringList(value.risks, safe.risks, 4),
      nextAgent: enumField(value.nextAgent, ['developer', 'reviewer', 'qa'], safe.nextAgent),
    }),
  });
}
