# AI Agent Office Simulator

픽셀아트 스타일의 AI 에이전트 협업 시뮬레이션 MVP

> **현재 상태: Supabase Live** — Vercel 배포 완료, Supabase events 테이블 실시간 insert 동작 중.

---

## 소개

5명의 AI 에이전트(Planner, Architect, Developer, Reviewer, QA)가 오피스에서 스프린트를 진행하는 모습을 픽셀아트로 시각화한 시뮬레이션입니다.

실제 Claude API·AgentOps 연동 이전에 UI/UX와 워크플로우 구조를 확정하기 위한 Visual Layer MVP입니다.

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
- **Workflow Graph** — Planner→Architect→Developer→Reviewer→QA React Flow 그래프 (활성 노드 하이라이트, QA→Dev 버그 엣지)

### 에이전트 클릭 상세 카드
에이전트 클릭 시 오버레이 카드 표시:
- 역할·상태·현재 태스크·완료 태스크 수
- 최근 이벤트 목록
- Trace 플레이스홀더 (AgentOps / LangGraph 연동 예정)

### 타입드 이벤트 버스
`src/lib/simulation/eventBus.ts`에 8종 이벤트 정의:
`task.created` · `agent.assigned` · `agent.moved` · `agent.status.changed` · `agent.message` · `meeting.started` · `task.completed` · `issue.found`

### Supabase Realtime 이벤트 영속화
- 시뮬레이션 이벤트가 Supabase `events` 테이블에 실시간 insert
- 어댑터 패턴으로 Mock/Live 자동 전환 (환경변수 유무 기준)
- 세션 ID 기반 중복 방지 (자신이 보낸 이벤트 필터링)
- 화면 상단 **SUPABASE LIVE** / **MOCK MODE** 연결 상태 배지

---

## 실행 방법

```bash
npm install
npm run dev       # http://localhost:3000
npm run lint      # ESLint 검사
npm run build     # 프로덕션 빌드
```

---

## Supabase 설정

Supabase 없이도 앱은 정상 동작합니다 (MOCK MODE). 이벤트 영속화 및 실시간 멀티플레이어가 필요한 경우:

> **Supabase Table Editor의 UTC 표시는 정상입니다.** DB는 `timestamptz`(UTC)로 저장되고, 화면 Event Log는 `Asia/Seoul`(KST, UTC+9) 기준으로 변환해 표시합니다. 시간대 변환은 `src/lib/time.ts`의 `formatKstTime`이 담당합니다.

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

Supabase Dashboard → SQL Editor에서 [`docs/supabase-schema.md`](docs/supabase-schema.md)의 SQL을 순서대로 실행합니다.

### 3. 타입 재생성 (선택)

```bash
npx supabase gen types typescript --project-id <ref> > src/lib/supabase/types.ts
```

### 4. 어댑터 활성화

환경변수가 설정되면 `realtimeAdapter`가 자동으로 `SupabaseRealtimeAdapter`로 전환됩니다.

### 아키텍처

```
eventBus.emit()
  └─ Zustand store 업데이트 (항상, 동기)
  └─ realtimeAdapter.broadcast()
       ├─ MockRealtimeAdapter        → no-op (env vars 없을 때)
       └─ SupabaseRealtimeAdapter    → events 테이블 INSERT (env vars 있을 때)
            └─ subscribe()           → postgres_changes 구독, session_id 중복 필터

simulationStore (상태 변경 시)
  ├─ moveAgent / setStatus / setTask / bumpCompleted
  │    └─ upsertAgent() → agents 테이블 UPSERT (conflict: id, session_id)
  ├─ addTask / updateTask
  │    └─ upsertTask()  → tasks  테이블 UPSERT (conflict: id)
  └─ setSpeech / resetStore → 퍼시스턴스 없음 (transient 또는 세션 범위)
```

### 연결 상태 배지

| 배지 | 의미 |
|------|------|
| MOCK MODE | 환경변수 미설정 — mock만 동작 |
| SUPABASE LIVE | 채널 구독 성공, 모든 쓰기 정상 |
| SUPABASE PARTIAL ERR | 채널은 OK, 일부 agent/task upsert 실패 |
| SUPABASE ERROR | 채널 연결 실패 |

### Vercel 배포 시 환경변수

Vercel Dashboard → Project → Settings → Environment Variables에서 동일한 변수를 설정합니다.
배포 후 화면 상단에 **SUPABASE LIVE** (초록) 배지가 표시되면 연결 성공입니다.

---

## Realtime 멀티플레이어 테스트

두 브라우저 창을 열어서 한쪽 이벤트가 반대쪽에 실시간 반영되는지 확인하는 방법입니다.

### 준비

1. Supabase 환경변수가 설정된 상태에서 앱을 실행합니다 (`npm run dev` 또는 Vercel 배포 URL)
2. 두 창 모두 화면 상단에 **SUPABASE LIVE** 배지가 보여야 합니다
3. 각 창은 별도의 `session_id` (탭 단위 UUID)를 가집니다

### 테스트 절차

| 단계 | 창 A (관찰자) | 창 B (조작자) |
|------|--------------|--------------|
| 1 | 앱 열기 (아무 동작 없이 대기) | 앱 열기 |
| 2 | Event Log 확인 | **Start Sprint** 버튼 클릭 |
| 3 | ✅ 창 B에서 발생한 이벤트가 Event Log에 실시간 표시 | 시뮬레이션 진행 |
| 4 | Agent Status 패널 확인 | 에이전트 상태 변경됨 |
| 5 | ✅ 창 B의 에이전트 상태가 창 A에도 반영 | — |
| 6 | Task Queue 확인 | **Add Task** 버튼 클릭 |
| 7 | ✅ 창 B에서 추가한 태스크가 창 A의 큐에 표시 | — |

### 주의 사항

- 같은 브라우저의 **같은 탭**을 새로고침하면 새 `session_id`가 발급됩니다
- **시크릿 창** 또는 **다른 브라우저**를 사용하면 완전히 독립된 세션으로 테스트됩니다
- 두 창이 동시에 Start Sprint를 누르면 각자의 시뮬레이션이 독립 실행되지만 이벤트 로그는 합산됩니다 (의도된 동작)
- 오피스 캐릭터 이동 애니메이션은 자신의 시뮬레이션 기준이며, 외부 세션의 포지션 변경은 상태만 동기화됩니다

### 구독 채널 구조

| 채널명 | 테이블 | 이벤트 | 필터 |
|--------|--------|--------|------|
| `sim-multiplayer` | `events` | INSERT | session_id ≠ 나 |
| `sim-multiplayer` | `agents` | INSERT, UPDATE | session_id ≠ 나 |
| `sim-multiplayer` | `tasks`  | INSERT, UPDATE | session_id ≠ 나 |
| `_conn_check` | — | channel state | 상태 배지 전용 |

---

## 현재 미연결 항목

다음 항목은 **스텁(stub)** 구현만 존재하며 실제 동작하지 않습니다.

| 파일 | 미연결 항목 |
|------|-------------|
| `src/lib/api/index.ts` | Claude API (Anthropic SDK) |
| `src/lib/agentops/index.ts` | AgentOps 이벤트 트래킹 |

---

## 향후 개발 로드맵

### 다음 단계 — 상태 동기화
- `agents` 테이블 상태 실시간 동기화 (에이전트 status/position)
- `tasks` 테이블 상태 실시간 동기화 (태스크 큐)
- 멀티 브라우저 Realtime 동기화 (다른 탭/클라이언트 간 상태 공유)

### Milestone 3 — LLM 연동
- Claude API (`claude-sonnet-4-6`) 실제 호출
- 에이전트별 시스템 프롬프트 및 대화 히스토리 관리
- LangGraph / CrewAI 워크플로우 실연결

### Milestone 4 — 관측성
- AgentOps 세션·이벤트 트래킹 연동
- `agent_traces` 테이블 활용 (LLM 호출 레이턴시, 토큰 수)
- Trace 카드 실데이터 연결

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
│   │   ├── OfficeCanvas.tsx  # 오피스 캔버스, 에이전트 클릭 카드
│   │   ├── ActionBar.tsx     # 스프린트 컨트롤 버튼 (Start/Meeting/Task/Complete/Reset)
│   │   ├── AgentSprite.tsx   # SVG 픽셀아트 스프라이트 + 상태별 애니메이션
│   │   ├── OfficeFurniture.tsx
│   │   └── SpeechBubble.tsx
│   ├── panels/
│   │   ├── TaskQueue.tsx     # 태스크 큐 패널
│   │   ├── AgentStatus.tsx   # 에이전트 상태 패널
│   │   └── EventLog.tsx      # 이벤트 로그 (접기/펼치기)
│   ├── command-center/
│   │   └── WorkflowGraph.tsx # React Flow 워크플로우 그래프 (Zustand 연결)
│   ├── RealtimeSyncClient.tsx    # null-render — useRealtimeSync 훅을 앱 레벨에서 마운트
│   └── debug/
│       └── ConnectionStatus.tsx  # Supabase 연결 상태 배지 (LIVE / PARTIAL ERR / ERROR)
│
├── lib/
│   ├── simulation/
│   │   ├── engine.ts         # SimulationEngine — 48초 루프 + 5가지 시나리오 메서드
│   │   ├── eventBus.ts       # 타입드 이벤트 버스 → realtimeAdapter 연결
│   │   └── config.ts         # 오피스 좌표, 에이전트 초기값
│   ├── supabase/
│   │   ├── client.ts         # Supabase 클라이언트 (null-safe, graceful fallback)
│   │   ├── session.ts        # 탭별 UUID 세션 ID (sessionStorage 영속)
│   │   ├── types.ts          # 데이터베이스 타입 정의
│   │   ├── realtime.ts       # RealtimeAdapter 인터페이스 + Mock/Supabase 구현체 (events write)
│   │   ├── persistence.ts    # upsertAgent / upsertTask (Phase 2)
│   │   └── errorTracker.ts   # 퍼시스턴스 에러 pub/sub (PARTIAL ERR 배지 구동)
│   └── hooks/
│       └── useRealtimeSync.ts  # Realtime 구독 훅 — events/agents/tasks 3-table 채널
│   ├── api/
│   │   └── index.ts          # Claude API 스텁
│   └── agentops/
│       └── index.ts          # AgentOps 스텁
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
| 워크플로우 그래프 | @xyflow/react (React Flow) |
| 실시간 DB | Supabase Realtime — events insert/subscribe + agents/tasks upsert 완료 |
| 배포 | Vercel (프로덕션) |
| 미래 LLM | Anthropic SDK (`@anthropic-ai/sdk`) — 미연결 |
| 미래 관측성 | AgentOps — 미연결 |
| 미래 워크플로우 | LangGraph / CrewAI — 미연결 |
