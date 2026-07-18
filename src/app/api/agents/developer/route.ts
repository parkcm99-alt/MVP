import { handleAgentPost } from '@/lib/llm/agentRoute';
import { normalizeText, oneOf, strings } from '@/lib/llm/json';
import type { DeveloperAgentResponse } from '@/lib/llm/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fallback(summary = 'Developer가 mock 모드에서 구현 계획을 준비했습니다.'): DeveloperAgentResponse {
  return {
    ok: true,
    provider: 'mock',
    role: 'developer',
    summary,
    implementationPlan: ['변경 범위를 작게 나누고 기존 mock/Realtime 경로를 유지합니다.', '서버 API와 UI 상태를 분리해 실패 fallback을 추가합니다.'],
    filesToChange: ['src/app/api/agents/developer/route.ts', 'src/components/panels/TaskQueue.tsx'],
    testPlan: ['mock fallback 응답 shape 확인', 'lint 및 production build 확인'],
    risks: ['비동기 상태 갱신이 기존 simulation과 충돌할 수 있습니다.'],
    nextAgent: 'reviewer',
  };
}

export async function POST(request: Request) {
  return handleAgentPost(request, {
    role: 'developer',
    schema: '{"summary":"string","implementationPlan":["string"],"filesToChange":["string"],"testPlan":["string"],"risks":["string"],"nextAgent":"reviewer|qa"}',
    instructions: 'Produce a practical implementation plan, likely files, API/state/component direction, test points and risks. Recommend reviewer or QA next.',
    fallback,
    normalize: (parsed, provider) => {
      const safe = fallback();
      return {
        ...safe,
        provider,
        summary: normalizeText(parsed.summary, safe.summary),
        implementationPlan: strings(parsed.implementationPlan, safe.implementationPlan),
        filesToChange: strings(parsed.filesToChange, safe.filesToChange),
        testPlan: strings(parsed.testPlan, safe.testPlan),
        risks: strings(parsed.risks, safe.risks, 4),
        nextAgent: oneOf(parsed.nextAgent, ['reviewer', 'qa'] as const, 'reviewer'),
      };
    },
  });
}
