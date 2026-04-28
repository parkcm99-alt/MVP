# AI Agent Office Simulator

픽셀아트 스타일의 AI Agent 협업 시뮬레이션 — Next.js + TypeScript + Zustand

---

## 프로젝트 개요

AI 에이전트 5명(Planner, Architect, Developer, Reviewer, QA)이 오피스에서 협업하는 모습을
픽셀아트로 시각화한 시뮬레이션 MVP입니다.

현재는 **Mock 전용 시각 레이어**이며, 실제 LLM/인프라 연동 이전에 UI/UX를 완성하는 단계입니다.

---

## 현재 MVP 상태 (v0.2.0-alpha)

- 에이전트 8가지 상태: `idle` `walking` `thinking` `coding` `reviewing` `testing` `meeting` `blocked`
- 역할별 고유 애니메이션: 개발자 키보드 타이핑, QA 점멸, 블로킹 시 흔들림 등
- 48초 자동 루프 시나리오: 스프린트 시작 → 아키텍처 미팅 → PR 개발 → QA 버그 발견 → 리뷰 완료 → 스탠드업 → 복귀
- 스프린트 컨트롤 버튼: Start Sprint / Call Meeting / Add Task / Complete Sprint / Reset
- 에이전트 클릭 → 상세 카드: 역할·상태·현재 태스크·완료 수·최근 이벤트
- Workflow Graph 플레이스홀더: Planner → Architect → Developer → Reviewer → QA (활성 노드 하이라이트)
- 타입드 이벤트 버스 (`eventBus.ts`): `task.created` / `agent.assigned` / `meeting.started` / `issue.found` 등 8종
- 실시간 이벤트 로그 · 태스크 큐 · 에이전트 상태 사이드 패널

---

## 실행 방법

```bash
cd /Users/parkyoungsun/mvp-agent-office
npm install
npm run dev
# http://localhost:3000
```

---

## Mock 전용 사항

다음 항목은 현재 **스텁(stub)** 구현만 존재하며 실제 동작하지 않습니다:

| 파일 | Mock 내용 |
|------|-----------|
| `src/lib/api/index.ts` | Claude API — 실제 요청 없음 |
| `src/lib/realtime/index.ts` | Supabase Realtime — 실제 구독 없음 |
| `src/lib/agentops/index.ts` | AgentOps — 실제 이벤트 전송 없음 |
| `src/lib/simulation/eventBus.ts` | TODO 주석으로 훅 위치 표시 |
| `src/components/command-center/CommandCenterPlaceholder.tsx` | React Flow 대신 정적 그래프 |

---

## 로드맵

### Milestone 2 — LLM 연동
- Claude API (`claude-sonnet-4-6`) 실제 호출
- 에이전트별 시스템 프롬프트 및 도구 호출
- LangGraph / CrewAI 워크플로우 실연결

### Milestone 3 — 실시간 인프라
- Supabase Realtime 멀티플레이어 구독
- 이벤트 영속화 (PostgreSQL)
- AgentOps 성능 트래킹 연동

### Milestone 4 — 워크플로우 시각화
- React Flow 전체 구현 (노드 드래그, 엣지 애니메이션)
- 에이전트 메시지 패싱 시각화
- AgentOps 이벤트 스트림 실시간 반영

---

## 미래 연동 위치 요약

```
src/lib/api/index.ts           ← Claude API (Anthropic SDK)
src/lib/realtime/index.ts      ← Supabase Realtime
src/lib/agentops/index.ts      ← AgentOps + React Flow 노드 정의
src/lib/simulation/eventBus.ts ← 이벤트 버스 (Supabase/AgentOps 훅 주석)
src/components/command-center/ ← React Flow 교체 예정
```

---

## 기술 스택

- **Next.js 16** (App Router, TypeScript)
- **Tailwind CSS** + 커스텀 CSS (globals.css)
- **Zustand** — 시뮬레이션 상태
- **SVG 픽셀아트** — `image-rendering: pixelated`
- **ResizeObserver** — DOM ref 직접 조작 (React 배칭 우회)
