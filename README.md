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
| Event Log 표시 제한 | ✅ 200개 렌더링 제한 |
| MOCK MODE fallback | ✅ 동작 |
| Claude API Planner 1단계 | ✅ Production live 호출 성공 (`provider:"claude"`) |
| Plan with Claude workflow | ✅ steps → Task Queue 자동 생성 → 담당 에이전트 처리 |
| Planner task assignment | ✅ 역할 키워드 기반 분배 + 복수 역할 task 분리 |
| agent_traces 기록 | ✅ `llm_call` / `handoff` / `decision` insert 경로 구현 |
| Debug Panel | ✅ Supabase/provider/trace/token/latency 상태 표시 |
| Trace Correlation Debugger | ✅ 최근 100개 trace/session timeline/anomaly/import-export |
| Architect Claude API | ✅ 서버 route + mock fallback + trace |
| Developer Claude API | ✅ 서버 route + mock fallback + trace |
| Reviewer Claude API | ✅ 서버 route + mock fallback + trace |
| QA Claude API | ✅ 서버 route + mock fallback + trace |

---

## 소개

5명의 AI 에이전트(Planner, Architect, Developer, Reviewer, QA)가 오피스에서 스프린트를 진행하는 모습을 픽셀아트로 시각화한 시뮬레이션입니다.

Planner, Architect, Developer, Reviewer, QA는 각각 분리된 서버 전용 API route를 사용합니다. `ENABLE_LIVE_LLM=false`(기본값)이거나 API key가 없으면 비용 없는 mock fallback으로 동작합니다. AgentOps, OpenAI, LangGraph, CrewAI 실제 연동은 아직 하지 않았습니다.

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
- **Ask Architect / Developer / Reviewer / QA** — 각 역할 담당 태스크를 역할별 Claude/mock route로 검토
- Planner 응답 `steps`를 Task Queue에 자동 반영하고, assigned agent별 mini workflow를 실행
- **Complete Sprint** — 스프린트 완료 시퀀스
- **Reset** — 초기 상태로 복귀

### 사이드 패널
- **Task Queue** — 태스크 상태(backlog/in-progress/review/done)·담당자 표시
- **Agent Status** — 에이전트별 현재 상태·현재 태스크·완료 수
- **Event Log** — 실시간 이벤트 스트림 (KST 시간 표시, 접기/펼치기)
- Event Log는 성능 보호를 위해 최신 200개까지만 렌더링
- **Workflow Graph** — Planner→Architect→Developer→Reviewer→QA React Flow 그래프 (활성 노드 하이라이트, QA→Dev 버그 엣지)
- **Debug Panel** — Supabase 상태, 마지막 역할별 LLM provider, traceRecorded, model, latency/token 표시 (접기/펼치기, mock/trace 실패 경고 표시)
- **Trace Correlation Debugger** — 최근 100개 trace를 session별로 묶고 timeline/anomaly/context/sanitized bundle을 표시
- **Operations Lens** — role/status/priority/trace type/session/keyword를 Task Queue, Event Log, Trace Correlation에 동시에 적용

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
| `agent_traces` | INSERT (append-only) | trace_type별 metadata | ✅ |

### 저장 필드

**agents**: `id` · `session_id` · `name` · `emoji` · `status` · `current_task` · `position_x` · `position_y` · `completed_tasks`

**tasks**: `id` · `session_id` · `title` · `description` · `assigned_to` · `status` · `priority`

**events**: `id` · `session_id` · `agent_id` · `agent_name` · `agent_color` · `type` · `message` · `metadata`

**agent_traces**: `id` · `session_id` · `agent_id` · `trace_type` · `input_tokens` · `output_tokens` · `latency_ms` · `model` · `metadata`

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

## Claude API 역할별 연결

> Planner, Architect, Developer, Reviewer, QA가 각각 서버 전용 API route를 사용합니다. 기본값은 비용 방지를 위해 모든 역할이 mock fallback으로 동작합니다.

| 항목 | 상태 |
|------|------|
| `@anthropic-ai/sdk` dependency | ✅ 추가 |
| Planner API route | ✅ `POST /api/agents/planner` |
| 요청 body | ✅ `{ taskTitle, taskDescription, sessionId }` (`session_id`도 호환) |
| 응답 형식 | ✅ `ok`, `provider`, `role`, `summary`, `steps`, `risks`, `nextAgent`, `traceRecorded` |
| live 호출 gate | ✅ `ENABLE_LIVE_LLM=true` + `ANTHROPIC_API_KEY` 필요 |
| 기본 동작 | ✅ `ENABLE_LIVE_LLM=false` 이면 mock fallback |
| 서버 전용 키 | ✅ `ANTHROPIC_API_KEY`는 `NEXT_PUBLIC_` 없이 서버에서만 사용 |
| Planner UI 테스트 | ✅ ActionBar `Plan with Claude` 버튼 |
| Supabase events 저장 | ✅ `agent.planning` 이벤트로 summary/steps 저장 시도, 실패해도 앱 유지 |
| Task Queue 반영 | ✅ Planner steps 기반 하위 task 자동 생성 |
| Mini workflow | ✅ assigned agent 상태 변경 → task done 처리 |
| Trace 기록 | ✅ Claude 성공 시 `llm_call`, task handoff/start 시 `handoff`/`decision` |
| Debug Panel | ✅ `/api/agents/planner` 응답의 provider/trace/model/token/latency 표시 |
| Trace Correlation Debugger | ✅ Supabase/local 최근 100개 + anomaly + sanitized bundle |
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
SUPABASE_SERVICE_ROLE_KEY=
```

`ANTHROPIC_API_KEY`는 서버 전용입니다. `NEXT_PUBLIC_ANTHROPIC_API_KEY` 같은 브라우저 노출 변수는 만들지 않습니다.
`CLAUDE_MODEL`을 비워두면 서버 코드가 `claude-sonnet-4-20250514`를 사용합니다. 설정한 모델이 `model_not_found`로 실패하면 이 안정적인 기본 모델로 한 번 재시도합니다.
`SUPABASE_SERVICE_ROLE_KEY`도 서버 전용입니다. Production의 역할별 API route에서 `llm_call` trace를 안정적으로 저장할 때 우선 사용하며, 브라우저에는 절대 노출하지 않습니다.

### 실제 호출 켜기

`.env.local` 또는 Vercel Environment Variables에 아래처럼 설정합니다.

```bash
ANTHROPIC_API_KEY=sk-ant-...
ENABLE_LIVE_LLM=true
CLAUDE_MODEL=claude-sonnet-4-6
SUPABASE_SERVICE_ROLE_KEY=<supabase-service-role-key>
```

`ENABLE_LIVE_LLM=false`이거나 `ANTHROPIC_API_KEY`가 비어 있으면 항상 mock 응답을 반환합니다. live 호출은 비용이 발생할 수 있으므로 테스트할 때만 `true`로 바꾸세요.
Planner API 응답에서 `provider:"claude"`와 `traceRecorded:true`가 함께 나오면 Claude live 호출과 `agent_traces.llm_call` 저장이 모두 성공한 상태입니다.

### Agent Trace 기록

`agent_traces` 테이블은 AgentOps 실제 연동 전까지 내부 관측 로그로 사용합니다. trace 저장은 실패해도 앱 흐름을 막지 않으며, API key/secret 같은 민감정보는 저장하지 않습니다.

| trace_type | 기록 시점 |
|------------|-----------|
| `llm_call` | 5개 역할이 서버 route에서 Claude live 호출에 성공했을 때 token/latency/model 기록 (`SUPABASE_SERVICE_ROLE_KEY` 우선 사용) |
| `handoff` | Planner 응답 steps로 만든 하위 task를 담당 에이전트에게 넘길 때 기록 |
| `decision` | Planner-generated task를 담당 에이전트가 시작할 때 기록 |

이 구조는 나중에 AgentOps SDK를 붙일 때 동일한 trace 이벤트를 외부 관측 시스템으로 확장할 수 있도록 만든 scaffolding입니다. 현재는 OpenAI, AgentOps, LangGraph, CrewAI 실제 연결을 하지 않습니다.

trace 저장은 실패해도 Planner 응답과 UI workflow를 막지 않습니다. 실패 시 Vercel Logs에는 status code와 redacted response body만 출력되며, API key 값은 로그/응답/metadata에 남기지 않습니다.

### Trace Correlation Debugger

Debug Panel의 접이식 debugger는 browser Supabase client와 local/mock trace를 합쳐 최신 100개를 session timeline으로 분석합니다. 수동 **Refresh**도 지원합니다.

표시 항목은 `trace_type`, `agent_id`, `model`, `latency_ms`, `input_tokens`, `output_tokens`, `created_at`(Asia/Seoul `HH:mm:ss KST`), metadata 요약입니다. metadata는 key/token/secret/password 등 민감정보로 보이는 필드를 표시하지 않습니다.

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
| `SUPABASE_SERVICE_ROLE_KEY` | Dashboard → Project Settings → API | 서버 전용 (`agent_traces.llm_call` insert 우선 키) |

`NEXT_PUBLIC_SUPABASE_ANON_KEY`에는 Supabase anon JWT만 넣습니다. `sk-ant-...` 같은 Claude/Anthropic key나 service role key를 넣으면 브라우저 번들에 노출되고 Supabase client가 `Invalid API key`로 실패합니다. 실수로 노출했다면 해당 provider key를 즉시 rotate하세요.

### 2. 스키마 적용

Supabase Dashboard → SQL Editor에서 [`docs/supabase-schema.md`](docs/supabase-schema.md)의 SQL을 순서대로 실행합니다.

### 3. 타입 재생성 (선택)

```bash
npx supabase gen types typescript --project-id <ref> > src/lib/supabase/types.ts
```

### 4. Vercel 배포

Vercel Dashboard → Project → Settings → Environment Variables에서 동일한 변수를 설정합니다.
`SUPABASE_SERVICE_ROLE_KEY`는 Production/Preview/Development 중 필요한 환경에 서버 전용으로 추가하고, `NEXT_PUBLIC_` prefix를 붙이지 않습니다.
배포 후 화면 상단에 **SUPABASE LIVE** (초록) 배지가 표시되면 연결 성공입니다.

---

## Next Roadmap

### Phase 3 — AgentOps Tracing
- `agent_traces` 테이블 실데이터 연결 완료 (`llm_call`, `handoff`, `decision`)
- Production `llm_call` 저장은 `SUPABASE_SERVICE_ROLE_KEY` 우선 사용
- Debug Panel + Agent Trace Viewer에서 LLM 호출 레이턴시·토큰 수 시각화
- 에이전트 클릭 카드 Trace 섹션 실연결
- AgentOps SDK 연동

### Phase 4 — Claude API Single-Agent Integration
- Planner API route 1단계 완료 (`ENABLE_LIVE_LLM` gate + mock fallback + live Claude)
- Planner 응답 steps → Task Queue 자동 생성 완료
- Planner-generated task mini workflow 완료
- 다음 단계: 에이전트 클릭 카드 Trace 섹션에 LLM latency/token 표시

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
│   │   └── agents/{planner,architect,developer,reviewer,qa}/route.ts
│   │                                  # 역할별 서버 전용 Claude/mock API route
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
│       ├── ConnectionStatus.tsx  # 연결 상태 배지 (LIVE / PARTIAL ERR / ERROR)
│       ├── DebugPanel.tsx        # Planner provider/trace/token/latency 디버그 패널
│       └── AgentTraceViewer.tsx  # session timeline/anomaly/bundle UI
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
│   ├── debug/
│   │   └── traceCorrelation.ts # anomaly 탐지 + bundle 검증/redaction
│   ├── llm/
│   │   ├── types.ts          # LLM provider/message/역할별 response 타입
│   │   ├── json.ts           # 공통 JSON/code-fence 파서
│   │   ├── agentRoute.ts     # 역할별 route 공통 handler
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
│   ├── simulationStore.ts    # Zustand 스토어
│   ├── debugStore.ts         # Supabase / LLM debug 상태
│   └── traceDebugStore.ts    # local traces/highlight/finding dedupe
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
| LLM | Anthropic SDK (`@anthropic-ai/sdk`) — 5개 역할 route에 live 옵션, 기본 mock |
| 관측성 | Supabase `agent_traces` + Trace Correlation Debugger — `llm_call`/`handoff`/`decision`/`tool_use`, AgentOps SDK는 미연동 |
| 미래 워크플로우 | LangGraph / CrewAI — Phase 5 예정 |

## 역할별 Claude API 준비 및 동작

- `/api/agents/planner`, `/architect`, `/developer`, `/reviewer`, `/qa`는 모두 Node.js 서버 route이며 API key를 브라우저에 노출하지 않습니다.
- 공통 `src/lib/llm/json.ts` parser가 code fence를 제거하고 raw JSON을 검증합니다.
- live 호출은 작은 `max_tokens`, 8초 timeout, retry 제한, 안전한 오류 분류를 사용합니다.
- 기본 `ENABLE_LIVE_LLM=false`에서는 모든 역할이 mock으로 동작하므로 비용이 발생하지 않습니다.
- Claude 성공 시 역할별 `llm_call` trace에 model, latency, input/output token, session id가 기록됩니다. 저장 실패는 UI 흐름을 중단하지 않습니다.
- Action Bar와 Task Queue의 역할별 버튼은 결과 요약과 핵심 필드를 Event Log에 남기고 Debug Panel telemetry를 갱신합니다.

### Supabase anon key 발급 위치

Supabase Dashboard → 해당 Project → **Project Settings → API**에서 Project URL과 `anon`/`publishable` public key를 확인해 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`에 설정합니다. `service_role` key는 서버 전용 `SUPABASE_SERVICE_ROLE_KEY`에만 저장하고 `NEXT_PUBLIC_` 접두사를 붙이지 마세요. Vercel에서는 Project Settings → Environment Variables의 Production 환경에 각각 등록한 뒤 재배포합니다.

### Trace Correlation Debugger

`Debug Panel → Trace Correlation Debugger`는 Supabase 또는 로컬/mock에서 최근 100개 trace를 읽어 `session_id`별 타임라인으로 묶고, 각 세션의 `agent_id / trace_type / metadata.task_title` 차원을 표시합니다. 세션을 선택하면 관련 Task Queue 항목, Event Log 조각, agent 상태를 함께 보여주며 일치하는 task를 강조합니다. 기존 `llm_call`, `handoff`, `decision`, `tool_use` badge는 유지됩니다.

자동 anomaly 규칙은 (1) `traceRecorded=false`, (2) planner handoff 후 decision 누락, (3) Ask Agent 후 llm_call 누락, (4) `latency_ms >= 10000`, (5) `finalStatus`/`approvalStatus`의 fail/reject/block/error 계열 값입니다. 각 항목은 민감정보 없는 요약과 안전한 점검 힌트를 제공합니다. **Create Debug Finding**은 동일 session/anomaly signature를 중복 생성하지 않고 reviewer 또는 QA용 local-only task와 Event Log 한 줄만 만듭니다(Supabase에는 쓰지 않음).

선택 세션은 schema v1 **Sanitized JSON Bundle**로 export/import할 수 있습니다. secret, token, authorization, API/service-role key처럼 보이는 key/value는 redaction됩니다. import는 read-only analysis mode이며 tasks/events/agent_traces에 쓰지 않습니다. 손상 JSON, 잘못된 shape, 미지원 schema version, 100개 초과 trace는 UI를 중단하지 않고 거부합니다. 그래도 bundle 공유 전에는 조직의 보안 정책에 따라 내용을 재검토하세요.

### Operations Lens

상단 **Operations Lens**에서 agent role, task status, priority, trace type, session ID, free-text keyword를 조합하면 같은 조건이 Task Queue, Event Log, Trace Correlation Debugger에 동시에 적용됩니다. 각 패널은 `filtered/total` 수, keyword 하이라이트, empty state와 **Clear all**을 제공합니다. 이는 원본 배열이나 Supabase schema를 바꾸지 않는 read-only derived view이며 Reset/Plan with Claude/realtime 갱신 뒤 현재 메모리·세션 데이터로 즉시 다시 계산됩니다.

Trace Correlation 영역의 **Lens warnings**는 필터 결과에서 task에 대응 event/trace가 없거나 session/agent role 상관관계가 어긋난 건수만 local-only로 요약합니다. 원문 metadata나 API key/secret은 warning에 포함하지 않으며 Supabase가 없는 mock/local mode에서도 동작합니다.
