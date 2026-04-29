/**
 * mockClaude — zero-cost LLM stub for development and mock simulation.
 *
 * Returns scripted, role-aware responses without any network calls.
 * Simulates realistic latency variance so UI behaviour matches the live path.
 *
 * Usage (same interface as claudeClient):
 *   const res = await mockClaude.complete(request);
 */

import type { LlmRequest, LlmResponse } from './types';

// ── Scripted responses per agent role ─────────────────────────────────────────

const MOCK_RESPONSES: Record<string, string[]> = {
  planner: [
    '이번 스프린트 목표를 정의했습니다. 주요 기능 3개를 우선순위에 따라 배분하겠습니다.',
    '요구사항 분석이 완료되었습니다. Architect와 킥오프 미팅을 잡겠습니다.',
    '스프린트 백로그를 업데이트했습니다. 리소스 배분은 현재 팀 역량 기준으로 최적화했습니다.',
    '리스크 항목 2개를 식별했습니다. 미티게이션 플랜을 공유하겠습니다.',
  ],
  architect: [
    '시스템 아키텍처 초안을 작성했습니다. Supabase + Next.js App Router 구조를 추천합니다.',
    'API 설계 검토 완료입니다. RESTful 엔드포인트 12개와 Realtime 채널 3개를 정의했습니다.',
    '데이터 모델 리뷰 결과, 인덱스 추가가 필요한 쿼리 패턴을 발견했습니다.',
    '기술 부채 항목을 정리했습니다. 다음 스프린트에서 리팩토링 일정을 잡겠습니다.',
  ],
  developer: [
    '기능 구현 완료입니다. 유닛 테스트 커버리지 87% 달성했습니다.',
    'PR을 오픈했습니다. 핵심 로직에 대한 인라인 주석을 추가했습니다.',
    'Issue #7 핫픽스 배포 완료입니다. 재발 방지를 위해 regression test를 추가했습니다.',
    'API 엔드포인트 통합 완료입니다. 응답 시간 평균 120ms 달성했습니다.',
  ],
  reviewer: [
    'PR #42 리뷰 완료입니다. 코멘트 2개 남겼고 전반적으로 LGTM입니다.',
    '보안 취약점 1건을 발견했습니다. SQL injection 방지 처리가 누락되어 있습니다.',
    '코드 품질 A등급입니다. 다만 함수 복잡도가 높은 부분은 리팩토링을 권장합니다.',
    '성능 병목 1개를 확인했습니다. N+1 쿼리 패턴이 있습니다. 수정 방법을 코멘트로 남겼습니다.',
  ],
  qa: [
    '회귀 테스트 전체 통과입니다. 신규 기능 테스트 케이스 8개 추가했습니다.',
    '버그 리포트: Issue #7 발견. 특정 입력값에서 에러가 발생합니다. 재현 스텝을 첨부합니다.',
    'E2E 테스트 결과 정상입니다. 배포 승인 가능합니다.',
    '부하 테스트 완료입니다. 동시 접속 500명까지 안정적으로 동작합니다.',
  ],
};

const FALLBACK_RESPONSES = [
  '작업을 검토 중입니다. 잠시 후 업데이트를 공유하겠습니다.',
  '분석 완료입니다. 결과를 팀에 공유하겠습니다.',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Fake async latency — normally distributed around ~400ms, range 200-900ms. */
async function simulateLatency(): Promise<number> {
  const ms = 200 + Math.floor(Math.random() * 700);
  await new Promise(resolve => setTimeout(resolve, ms));
  return ms;
}

// ── Mock client ───────────────────────────────────────────────────────────────

export const mockClaude = {
  /**
   * Returns a scripted response for the given agent role.
   * Simulates network latency so callers behave identically to the live path.
   */
  async complete(request: LlmRequest): Promise<LlmResponse> {
    const latencyMs = await simulateLatency();

    const pool    = MOCK_RESPONSES[request.agentRole] ?? FALLBACK_RESPONSES;
    const content = pickRandom(pool);

    return {
      provider:     'mock',
      content,
      inputTokens:  0,
      outputTokens: 0,
      latencyMs,
      model:        'mock',
    };
  },
};
