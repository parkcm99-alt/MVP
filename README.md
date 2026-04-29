# AI Agent Office Simulator

픽셀아트 스타일의 AI 에이전트 협업 시뮬레이션 MVP

---

## Current MVP Status

> **Production Ready** — Vercel 배포 + Supabase Realtime 동기화 완료 (2026-04)

| 항목 | 상태 |
|------|------|
| Vercel Production 배포 | ✅ 정상 |
| Supabase LIVE 연결 | ✅ 확인 |
| events 테이블 저장 | ✅ 확인 |
| agents 테이블 저장 | ✅ 확인 |
| tasks 테이블 저장 | ✅ 확인 |
| 멀티 브라우저 Realtime 동기화 | ✅ 테스트 완료 |
| Event Log KST 시간 표시 | ✅ 확인 |
| MOCK MODE fallback | ✅ 동작 |
| Claude API Planner 1단계 | ✅ 서버 route + mock fallback, live 기본 OFF |

---

## 소개

5명의 AI 에이전트(Planner, Architect, Developer, Reviewer, QA)가 오피스에서 스프린트를 진행하는 모습을 픽셀아트로 시각화한 시뮬레이션입니다.

실제 Claude API·AgentOps 연동 이전에 UI/UX와 워크플로우 구조를 확정하기 위한 Visual Layer MVP입니다.

---

## Verified Features

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
- **Add Task** — 랜덤 태스크 큐에 추가
- **Plan with Claude** — 가장 우선순위 높은 태스크를 Planner Claude/mock으로 계획
- **Complete Sprint** — 스프린트 완료 시퀀스
- **Reset** — 초기 상태로 복귀

### 사이드 패널
- **Task Queue** — 태스크 상태(backlog/in-progress/review/done)·담당자 표시
- **Agent Status** — 에이전트별 현재 상태·현재 태스크·완료 수
- **Event Log** — 실시간 이벤트 스트림 (KST 시간 표시, 접기/펼치기)
- **Workflow Graph** — Planner→Architect→Developer→Reviewer→QA React Flow 그래프 (활성 노드 하이라이트, QA→Dev 버그 엣지)

### 타입드 이벤트 버스
`src/lib/simulation/eventBus.ts`에 8종 이벤트 정의:
`task.created` · `agent.assigned` · `agent.moved` · `agent.status.changed` · `agent.message` · `agent.planning` · `meeting.started` · `task.completed` · `issue.found`

---

## Supabase Persistence Status

### 저장 확인 완료

| 테이블 | 저장 방식 | 중복 방지 | 확인 |
|--------|----------|----------|------|
| `events` | INSERT (append-only) | session_id 필터 | ✅ |
| `agents` | UPSERT (id, session_id) | 동일 row 덮어쓰기 | ✅ |
| `tasks` | UPSERT (id) | 동일 row 덮어쓰기 | ✅ |

### 저장 필드

**agents**: `id` · `session_id` · `name` · `emoji` · `status` · `current_task` · `position_x` · `position_y` · `completed_tasks`

**tasks**: `id` · `session_id` · `title` · `description` · `assigned_to` · `status` · `priority`

**events**: `id` · `session_id` · `agent_id` · `agent_name` · `agent_color` · `type` · `message` · `metadata`

### 아키텍처

```
eventBus.emit()
  └─ Zustand store 업데이트 (항상, 동기)
  └─ realtimeAdapter.broadcast()
       ├─ MockRealtimeAdapter     → no-op (env vars 없을 때)
       └─ SupabaseRealtimeAdapter → events 테이블 INSERT

simulationStore (상태 변경 시)
  ├─ moveAgent / setStatus / setTask / bumpCompleted
  │    └─ upsertAgent() → agents 테이블 UPSERT
  ├─ addTask / updateTask
  │    └─ upsertTask()  → tasks  테이블 UPSERT
  └─ setSpeech / resetStore → persist 없음 (transient)

useRealtimeSync (외부 세션 수신 시)
  ├─ events INSERT  → store.addEvent()    (session_id ≠ 나)
  ├─ agents *       → store.syncAgent()   (session_id ≠ 나, no re-persist)
  └─ tasks  *       → store.syncTask()    (session_id ≠ 나, no re-persist)
```

### 연결 상태 배지

| 배지 | 의미 |
|------|------|
| MOCK MODE | 환경변수 미설정 — mock만 동작 |
| SUPABASE LIVE | 채널 구독 성공, 모든 쓰기 정상 |
| SUPABASE PARTIAL ERR | 채널은 OK, 일부 upsert 실패 |
| SUPABASE ERROR | 채널 연결 실패 |

---

## Claude API Planner Stage 1

> Planner 에이전트만 서버 전용 API route로 Claude live 호출을 사용할 수 있습니다. 기본값은 비용 방지를 위해 mock fallback입니다.

| 항목 | 상태 |
|------|------|
| `@anthropic-ai/sdk` dependency | ✅ 추가 |
| Planner API route | ✅ `POST /api/agents/planner` |
| 요청 body | ✅ `{ taskTitle, taskDescription }` |
| 응답 형식 | ✅ `ok`, `provider`, `role`, `summary`, `steps`, `risks`, `nextAgent` |
| live 호출 gate | ✅ `ENABLE_LIVE_LLM=true` + `ANTHROPIC_API_KEY` 필요 |
| 기본 동작 | ✅ `ENABLE_LIVE_LLM=false` 이면 mock fallback |
| 서버 전용 키 | ✅ `ANTHROPIC_API_KEY`는 `NEXT_PUBLIC_` 없이 서버에서만 사용 |
| Planner UI 테스트 | ✅ ActionBar `Plan with Claude` 버튼 |
| Supabase events 저장 | ✅ `agent.planning` 이벤트로 summary/steps 저장 시도, 실패해도 앱 유지 |
| LLM 공통 타입 | ✅ `src/lib/llm/types.ts` |
| Mock Claude 응답 | ✅ `src/lib/llm/mockClaude.ts` — 네트워크/API 호출 없음 |
| Claude client | ✅ `src/lib/llm/claudeClient.ts` — `server-only`, timeout/max token 제한, 안전 fallback |
| 역할별 시스템 프롬프트 | ✅ `src/lib/agents/prompts.ts` |
| OpenAI / AgentOps / LangGraph / CrewAI 실연결 | 🚫 아직 비활성화 |

### Claude 환경변수

```bash
ANTHROPIC_API_KEY=
ENABLE_LIVE_LLM=false
CLAUDE_MODEL=
```

`ANTHROPIC_API_KEY`는 서버 전용입니다. `NEXT_PUBLIC_ANTHROPIC_API_KEY` 같은 브라우저 노출 변수는 만들지 않습니다.
`CLAUDE_MODEL`을 비워두면 서버 코드가 `claude-sonnet-4-20250514`를 사용합니다. 설정한 모델이 `model_not_found`로 실패하면 이 안정적인 기본 모델로 한 번 재시도합니다.

### 실제 호출 켜기

`.env.local` 또는 Vercel Environment Variables에 아래처럼 설정합니다.

```bash
ANTHROPIC_API_KEY=sk-ant-...
ENABLE_LIVE_LLM=true
CLAUDE_MODEL=claude-sonnet-4-6
```

`ENABLE_LIVE_LLM=false`이거나 `ANTHROPIC_API_KEY`가 비어 있으면 항상 mock 응답을 반환합니다. live 호출은 비용이 발생할 수 있으므로 테스트할 때만 `true`로 바꾸세요.

### Agent Trace 기록

`agent_traces` 테이블은 AgentOps 실제 연동 전까지 내부 관측 로그로 사용합니다. trace 저장은 실패해도 앱 흐름을 막지 않으며, API key/secret 같은 민감정보는 저장하지 않습니다.

| trace_type | 기록 시점 |
|------------|-----------|
| `llm_call` | Planner가 서버 route에서 Claude live 호출에 성공했을 때 token/latency/model 기록 |
| `handoff` | Planner 응답 steps로 만든 하위 task를 담당 에이전트에게 넘길 때 기록 |
| `decision` | Planner-generated task를 담당 에이전트가 시작할 때 기록 |

이 구조는 나중에 AgentOps SDK를 붙일 때 동일한 trace 이벤트를 외부 관측 시스템으로 확장할 수 있도록 만든 scaffolding입니다. 현재는 OpenAI, AgentOps, LangGraph, CrewAI 실제 연결을 하지 않습니다.

---

## Realtime Sync Test Result

### 테스트 완료 항목

| 시나리오 | 결과 |
|----------|------|
| 창 B에서 Start Sprint → 창 A의 Event Log에 이벤트 표시 | ✅ |
| 창 B의 에이전트 상태 변경 → 창 A의 Agent Status 패널 반영 | ✅ |
| 창 B에서 Add Task → 창 A의 Task Queue에 태스크 표시 | ✅ |
| 자신이 발생시킨 이벤트 중복 표시 없음 | ✅ |
| Supabase 미설정 시 mock mode 단독 동작 | ✅ |

### 테스트 방법

1. Supabase 환경변수가 설정된 앱을 두 개의 창에서 엽니다 (시크릿 창 또는 다른 브라우저 권장)
2. 두 창 모두 상단에 **SUPABASE LIVE** 배지 확인
3. 창 B에서 **Start Sprint** → 창 A의 Event Log에 이벤트가 KST 시간과 함께 실시간 표시

| 단계 | 창 A (관찰자) | 창 B (조작자) |
|------|--------------|--------------|
| 1 | 대기 | Start Sprint 클릭 |
| 2 | ✅ Event Log에 이벤트 실시간 표시 | 시뮬레이션 진행 |
| 3 | ✅ Agent Status 패널 에이전트 상태 반영 | — |
| 4 | Add Task 결과 확인 | Add Task 클릭 |
| 5 | ✅ Task Queue에 태스크 표시 | — |

### 구독 채널 구조

| 채널명 | 테이블 | 이벤트 | 필터 |
|--------|--------|--------|------|
| `sim-multiplayer` | `events` | INSERT | session_id ≠ 나 |
| `sim-multiplayer` | `agents` | INSERT, UPDATE | session_id ≠ 나 |
| `sim-multiplayer` | `tasks`  | INSERT, UPDATE | session_id ≠ 나 |
| `_conn_check` | — | channel state | 상태 배지 전용 |

---

## Known Timezone Behavior

> **Supabase Table Editor의 UTC 표시는 정상입니다.**

| 위치 | 시간대 | 예시 |
|------|--------|------|
| Supabase Table Editor (`timestamp` 컬럼) | UTC | `2025-04-29 12:00:00+00` |
| 앱 화면 Event Log | KST (UTC+9) | `21:00:00` |

- DB는 `timestamptz`(UTC)로 저장하며, 이는 표준 동작입니다
- 화면 표시는 `src/lib/time.ts`의 `formatKstTime()`이 `Asia/Seoul` 타임존으로 변환합니다
- 저장 방식은 변경하지 않으며, 표시 레이어에서만 변환합니다

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

Supabase 없이도 앱은 정상 동작합니다 (MOCK MODE). 이벤트 영속화 및 Realtime 동기화가 필요한 경우:

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

### 4. Vercel 배포

Vercel Dashboard → Project → Settings → Environment Variables에서 동일한 변수를 설정합니다.
배포 후 화면 상단에 **SUPABASE LIVE** (초록) 배지가 표시되면 연결 성공입니다.

---

## Next Roadmap

### Phase 3 — AgentOps Tracing
- `agent_traces` 테이블 실데이터 연결 완료 (`llm_call`, `handoff`, `decision`)
- LLM 호출 레이턴시·토큰 수 시각화
- 에이전트 클릭 카드 Trace 섹션 실연결
- AgentOps SDK 연동

### Phase 4 — Claude API Single-Agent Integration
- Planner API route 1단계 완료 (`ENABLE_LIVE_LLM` gate + mock fallback)
- 다음 단계: Planner 응답을 메인 시뮬레이션 루프에 점진 연결
- 에이전트 클릭 카드 Trace 섹션에 LLM latency/token 표시

### Phase 5 — LangGraph / CrewAI Orchestration
- 5 에이전트 전체 LangGraph 워크플로우 실연결
- CrewAI 기반 에이전트 협업 시나리오
- 실제 태스크 분배 및 핸드오프

### Phase 6 — Production Auth / Session Isolation
- Supabase Auth 연동 (사용자별 세션 격리)
- Row Level Security 강화 (사용자 ID 기반)
- 세션 히스토리 조회 및 재생

---

## 폴더 구조

```
src/
├── app/
│   ├── page.tsx              # 루트 레이아웃 — office-col / side-col 배치
│   ├── layout.tsx
│   ├── api/
│   │   └── agents/planner/route.ts  # Planner 서버 전용 Claude/mock API route
│   └── globals.css           # 전체 CSS (픽셀 테마, 애니메이션, 패널 스타일)
│
├── components/
│   ├── office/
│   │   ├── OfficeCanvas.tsx  # 오피스 캔버스, 에이전트 클릭 카드
│   │   ├── ActionBar.tsx     # 스프린트 컨트롤 버튼
│   │   ├── AgentSprite.tsx   # SVG 픽셀아트 스프라이트 + 상태별 애니메이션
│   │   ├── OfficeFurniture.tsx
│   │   └── SpeechBubble.tsx
│   ├── panels/
│   │   ├── TaskQueue.tsx     # 태스크 큐 패널
│   │   ├── AgentStatus.tsx   # 에이전트 상태 패널
│   │   └── EventLog.tsx      # 이벤트 로그 (KST 시간, 접기/펼치기)
│   ├── command-center/
│   │   └── WorkflowGraph.tsx # React Flow 워크플로우 그래프
│   ├── RealtimeSyncClient.tsx    # null-render — useRealtimeSync 훅 마운트
│   └── debug/
│       └── ConnectionStatus.tsx  # 연결 상태 배지 (LIVE / PARTIAL ERR / ERROR)
│
├── lib/
│   ├── simulation/
│   │   ├── engine.ts         # SimulationEngine — 48초 루프 + 5가지 시나리오
│   │   ├── eventBus.ts       # 타입드 이벤트 버스 → realtimeAdapter 연결
│   │   └── config.ts         # 오피스 좌표, 에이전트 초기값
│   ├── supabase/
│   │   ├── client.ts         # Supabase 클라이언트 (null-safe)
│   │   ├── session.ts        # 탭별 UUID 세션 ID
│   │   ├── types.ts          # DB 타입 정의
│   │   ├── realtime.ts       # RealtimeAdapter (Mock / Supabase)
│   │   ├── persistence.ts    # upsertAgent / upsertTask
│   │   ├── traces.ts         # agent_traces insert 유틸
│   │   └── errorTracker.ts   # 퍼시스턴스 에러 pub/sub
│   ├── time.ts               # formatKstTime — UTC → KST 변환
│   ├── agents/
│   │   └── prompts.ts        # Planner/Architect/Developer/Reviewer/QA 시스템 프롬프트 초안
│   ├── llm/
│   │   ├── types.ts          # LLM provider/message/response/prompt 타입
│   │   ├── mockClaude.ts     # 비용 없는 Claude mock 응답
│   │   └── claudeClient.ts   # 서버 전용 Claude SDK client + 안전 fallback
│   ├── api/
│   │   └── index.ts          # Claude API 스텁
│   └── agentops/
│       └── index.ts          # AgentOps 스텁
│
├── hooks/
│   └── useRealtimeSync.ts    # Realtime 구독 훅 (events/agents/tasks)
│
├── store/
│   └── simulationStore.ts    # Zustand 스토어
│
└── types/
    └── index.ts              # 전체 타입 정의
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
| 실시간 DB | Supabase Realtime — events/agents/tasks 3-table 동기화 완료 |
| 배포 | Vercel (프로덕션) |
| LLM | Anthropic SDK (`@anthropic-ai/sdk`) — Planner route만 live 옵션, 기본 mock |
| 미래 관측성 | AgentOps — Phase 3 예정 |
| 미래 워크플로우 | LangGraph / CrewAI — Phase 5 예정 |
