# AI Agent Office Simulator

픽셀아트 스타일의 AI 에이전트 협업 시뮬레이션 MVP

> **현재 상태: Mock Mode** — 실제 LLM/인프라 연동 없이 시각 레이어만 동작합니다.

---

## 소개

5명의 AI 에이전트(Planner, Architect, Developer, Reviewer, QA)가 오피스에서 스프린트를 진행하는 모습을 픽셀아트로 시각화한 시뮬레이션입니다.

실제 Claude API·Supabase·AgentOps 연동 이전에 UI/UX와 워크플로우 구조를 확정하기 위한 Visual Layer MVP입니다.

---

## 구현된 기능

### 픽셀 오피스 시뮬레이션
- 8가지 에이전트 상태: `idle` `walking` `thinking` `coding` `reviewing` `testing` `meeting` `blocked`
- 역할별 고유 SVG 픽셀아트 스프라이트 + 상태별 CSS 애니메이션
- 블로킹 시 셔츠 적색 변환, 말풍선 표시
- 48초 자동 루프 시나리오 (스프린트 시작 → 아키텍처 미팅 → PR 개발 → QA 버그 발견 → 리뷰 → 스탠드업 → 복귀)

### 5 AI 에이전트
| 에이전트 | 역할 | 활성 상태 |
|----------|------|-----------|
| Planner | 스프린트 계획 수립 | `thinking` |
| Architect | 시스템 설계 | `thinking` |
| Developer | 기능 구현 | `coding` |
| Reviewer | 코드 리뷰 | `reviewing` |
| QA | 품질 검증 | `testing` |

### 컨트롤 패널
- **Start Sprint** — 48초 루프 시나리오 시작
- **Call Meeting** — 전체 미팅 소집
- **Add Task** — 랜덤 태스크 태스크 큐에 추가
- **Complete Sprint** — 스프린트 완료 시퀀스
- **Reset** — 초기 상태로 복귀

### 사이드 패널
- **Task Queue** — 태스크 상태(pending/in-progress/done)·담당자 표시
- **Agent Status** — 에이전트별 현재 상태·현재 태스크·완료 수
- **Event Log** — 실시간 이벤트 스트림 (접기/펼치기)
- **Workflow Graph** — Planner→Architect→Developer→Reviewer→QA 플로우 (활성 노드 하이라이트, React Flow 교체 예정)

### 에이전트 클릭 상세 카드
에이전트 클릭 시 오버레이 카드 표시:
- 역할·상태·현재 태스크·완료 태스크 수
- 최근 이벤트 목록
- Trace 플레이스홀더 (AgentOps / LangGraph 연동 예정)

### 타입드 이벤트 버스
`src/lib/simulation/eventBus.ts`에 8종 이벤트 정의:
`task.created` · `agent.assigned` · `agent.moved` · `agent.status.changed` · `agent.message` · `meeting.started` · `task.completed` · `issue.found`

---

## 실행 방법

```bash
npm install
npm run dev       # http://localhost:3000
npm run lint      # ESLint 검사
npm run build     # 프로덕션 빌드
```

---

## Supabase 설정 (선택 — Mock Mode에서는 불필요)

Supabase 없이도 앱은 정상 동작합니다. 실시간 멀티플레이어 및 이벤트 영속화가 필요한 경우:

### 1. 환경변수 설정

```bash
cp .env.example .env.local
# .env.local 파일을 열고 아래 값 입력
```

| 변수 | 위치 | 용도 |
|------|------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | Dashboard → Project Settings → API | 브라우저 클라이언트 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Dashboard → Project Settings → API | 브라우저 클라이언트 |
| `SUPABASE_SERVICE_ROLE_KEY` | Dashboard → Project Settings → API | 서버 전용 (admin 작업) |

### 2. 스키마 적용

Supabase Dashboard → SQL Editor에서 [`docs/supabase-schema.md`](docs/supabase-schema.md)의 SQL을 실행합니다.

### 3. 타입 재생성

```bash
npx supabase gen types typescript --project-id <ref> > src/lib/supabase/types.ts
```

### 4. 어댑터 활성화

환경변수가 설정되면 `realtimeAdapter`가 자동으로 `SupabaseRealtimeAdapter`로 전환됩니다.
`src/lib/supabase/realtime.ts` 내 stub 주석을 해제하면 실제 브로드캐스트가 동작합니다.

### 아키텍처 (어댑터 패턴)

```
eventBus.emit()
  └─ Zustand store 업데이트 (항상)
  └─ realtimeAdapter.broadcast()
       ├─ MockRealtimeAdapter  → no-op (env vars 없을 때)
       └─ SupabaseRealtimeAdapter → supabase.channel('sim-events').send() (env vars 있을 때)
```

---

## Mock Mode — 미연결 항목

다음 항목은 **스텁(stub)** 구현만 존재하며 실제 동작하지 않습니다.

| 파일 | 미연결 항목 |
|------|-------------|
| `src/lib/api/index.ts` | Claude API (Anthropic SDK) |
| `src/lib/realtime/index.ts` | Supabase Realtime 채널 구독 |
| `src/lib/agentops/index.ts` | AgentOps 이벤트 트래킹 |
| `src/lib/simulation/eventBus.ts` | Supabase / AgentOps 훅 (TODO 주석으로 위치 표시) |
| `src/components/command-center/` | React Flow (현재 정적 SVG 플레이스홀더) |

---

## 향후 개발 로드맵

### Milestone 3 — LLM 연동
- Claude API (`claude-sonnet-4-6`) 실제 호출
- 에이전트별 시스템 프롬프트 및 대화 히스토리 관리
- LangGraph / CrewAI 워크플로우 실연결

### Milestone 4 — 실시간 인프라
- Supabase Realtime 멀티플레이어 구독
- 이벤트 영속화 (PostgreSQL `sim_events` 테이블)
- AgentOps 세션·이벤트 트래킹 연동

### Milestone 5 — 워크플로우 시각화
- React Flow 전체 구현 (노드 드래그, 엣지 애니메이션)
- AgentOps Trace 실시간 반영
- 에이전트 간 메시지 패싱 시각화

---

## 폴더 구조

```
src/
├── app/
│   ├── page.tsx              # 루트 레이아웃 — office-col / side-col 배치
│   ├── layout.tsx
│   └── globals.css           # 전체 CSS (픽셀 테마, 애니메이션, 패널 스타일)
│
├── components/
│   ├── office/
│   │   ├── OfficeCanvas.tsx  # 오피스 캔버스, 스프린트 버튼, 에이전트 클릭 카드
│   │   ├── AgentSprite.tsx   # SVG 픽셀아트 스프라이트 + 상태별 애니메이션
│   │   ├── OfficeFurniture.tsx
│   │   └── SpeechBubble.tsx
│   ├── panels/
│   │   ├── TaskQueue.tsx     # 태스크 큐 패널
│   │   ├── AgentStatus.tsx   # 에이전트 상태 패널
│   │   └── EventLog.tsx      # 이벤트 로그 (접기/펼치기)
│   └── command-center/
│       ├── WorkflowGraph.tsx             # React Flow 워크플로우 그래프 (실제 구현)
│       └── CommandCenterPlaceholder.tsx  # 이전 정적 플레이스홀더 (보존)
│
├── lib/
│   ├── simulation/
│   │   ├── engine.ts         # SimulationEngine — 48초 루프 + 5가지 시나리오 메서드
│   │   ├── eventBus.ts       # 타입드 이벤트 버스 → realtimeAdapter 연결됨
│   │   └── config.ts         # 오피스 좌표, 에이전트 초기값
│   ├── supabase/
│   │   ├── client.ts         # Supabase 클라이언트 (null-safe, graceful fallback)
│   │   ├── types.ts          # 데이터베이스 타입 정의
│   │   └── realtime.ts       # RealtimeAdapter 인터페이스 + Mock/Supabase 구현체
│   ├── api/
│   │   └── index.ts          # Claude API 스텁
│   ├── realtime/
│   │   └── index.ts          # Supabase Realtime 채널 스텁 (구버전)
│   └── agentops/
│       └── index.ts          # AgentOps 스텁 + 워크플로우 노드/엣지 정의
│
├── store/
│   └── simulationStore.ts    # Zustand 스토어 — 에이전트·태스크·이벤트 상태
│
└── types/
    └── index.ts              # 전체 타입 정의 (AgentRole, AgentStatus, BusEventType 등)
```

---

## 기술 스택

| 항목 | 선택 |
|------|------|
| 프레임워크 | Next.js 16 (App Router, TypeScript, Turbopack) |
| 상태 관리 | Zustand |
| 스타일 | 커스텀 CSS (`globals.css`) — Tailwind 미사용 |
| 그래픽 | SVG 픽셀아트 (`image-rendering: pixelated`) |
| 렌더링 최적화 | ResizeObserver + DOM ref 직접 조작 (React 배칭 우회) |
| 미래 LLM | Anthropic SDK (`@anthropic-ai/sdk`) — 미연결 |
| 실시간 (준비) | Supabase Realtime — 어댑터 구조 완료, 실제 호출 미연결 |
| 미래 관측성 | AgentOps — 미연결 |
| 미래 워크플로우 | LangGraph / CrewAI / React Flow — 미연결 |
