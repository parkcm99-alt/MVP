import { handleAgentRequest } from '@/lib/llm/agentRoute';
import { enumField, stringList, textField } from '@/lib/llm/json';
import type { DeveloperAgentResponse } from '@/lib/llm/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fallback: DeveloperAgentResponse = {
  ok: true,
  provider: 'mock',
  role: 'developer',
  summary: '작은 단위의 구현과 기존 mock/Supabase 경로 보존을 우선합니다.',
  implementationPlan: ['기존 상태와 API 계약을 확인합니다.', '작은 변경 단위로 구현하고 안전 fallback을 유지합니다.'],
  filesToChange: ['관련 Route Handler', '관련 Client Component', '공유 타입 또는 유틸'],
  testPlan: ['mock mode를 확인합니다.', 'lint와 production build를 실행합니다.'],
  risks: ['기존 Realtime 흐름과 상태 변경이 충돌할 수 있습니다.'],
  nextAgent: 'reviewer',
};

export async function POST(request: Request) {
  return handleAgentRequest(request, {
    role: 'developer',
    fallback,
    schema: '{"summary":"string","implementationPlan":["string"],"filesToChange":["string"],"testPlan":["string"],"risks":["string"],"nextAgent":"reviewer|qa"}',
    instruction: 'Produce an implementation plan, expected files, API/state/component direction, practical tests, risks, and next owner.',
    parse: (value, safe) => ({
      ...safe,
      summary: textField(value.summary, safe.summary),
      implementationPlan: stringList(value.implementationPlan, safe.implementationPlan, 5),
      filesToChange: stringList(value.filesToChange, safe.filesToChange, 6),
      testPlan: stringList(value.testPlan, safe.testPlan, 5),
      risks: stringList(value.risks, safe.risks, 4),
      nextAgent: enumField(value.nextAgent, ['reviewer', 'qa'], safe.nextAgent),
    }),
  });
}
