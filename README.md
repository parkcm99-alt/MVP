# AI Agent Office Simulator

픽셀아트 스타일의 AI 에이전트 협업 시뮬레이션 MVP

---

## Current MVP Status

> **Mock-first MVP** — 기존 Vercel/Supabase Realtime 기반 위에 5개 Agent route와 운영 디버깅 도구를 추가했습니다 (2026-04). 기본값은 비용 없는 mock입니다.

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
| Claude API Agent routes | ✅ Planner / Architect / Developer / Reviewer / QA, 서버 전용 + mock fallback |
| Plan with Claude workflow | ✅ steps → Task Queue 자동 생성 → 담당 에이전트 처리 |
| Planner task assignment | ✅ 역할 키워드 기반 분배 + 복수 역할 task 분리 |
| agent_traces 기록 | ✅ `llm_call` / `handoff` / `decision` insert 경로 구현 |
| Debug Panel | ✅ Supabase/provider/trace/token/latency 상태 표시 |
| Agent Trace Correlation Debugger | ✅ 최근 100개 trace, session timeline, anomaly, sanitized bundle |
| Operations Lens | ✅ Task / Event / Trace 공통 read-only 검색·필터 |

---

## 소개

5명의 AI 에이전트(Planner, Architect, Developer, Reviewer, QA)가 오피스에서 스프린트를 진행하는 모습을 픽셀아트로 시각화한 시뮬레이션입니다.

5개 역할 모두 서버 전용 API route에서 Claude live 옵션을 제공하지만, `ENABLE_LIVE_LLM=false`가 기본이며 key가 없거나 호출에 실패하면 기존 mock simulation으로 안전하게 돌아갑니다. AgentOps, OpenAI, LangGraph, CrewAI 실제 연동은 아직 하지 않았습니다.

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
- Planner 응답 `steps`를 Task Queue에 자동 반영하고, assigned agent별 mini workflow를 실행
- **Complete Sprint** — 스프린트 완료 시퀀스
- **Reset** — 초기 상태로 복귀

### 사이드 패널
- **Task Queue** — 태스크 상태(backlog/in-progress/review/done)·담당자 표시, 담당 task의 **Ask Architect / Developer / Reviewer / QA** 호출
- **Agent Status** — 에이전트별 현재 상태·현재 태스크·완료 수
- **Event Log** — 실시간 이벤트 스트림 (KST 시간 표시, 접기/펼치기)
- Event Log는 성능 보호를 위해 최신 200개까지만 렌더링
- **Workflow Graph** — Planner→Architect→Developer→Reviewer→QA React Flow 그래프 (활성 노드 하이라이트, QA→Dev 버그 엣지)
- **Debug Panel** — 마지막 Agent 호출의 Supabase 상태, provider/role, `traceRecorded`, model, latency/token, 호출 시각 표시 (mock/trace 실패 경고, 접이식 overlay)
- **Trace Correlation Debugger** — 최근 100개 remote/local trace를 session timeline으로 분석하고 관련 task/event/agent 상태를 연결
- **Operations Lens** — 상단 공통 필터가 Task Queue, Event Log, Trace Debugger에 동시에 적용되는 read-only 운영 뷰

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

## Claude API Agent Routes (mock-first)

Claude API 연결 전 준비물인 `.env.example` placeholder, `src/lib/llm/{types,mockClaude,claudeClient,json}.ts`, 역할별 `src/lib/agents/prompts.ts`가 포함되어 있습니다. 실제 SDK 호출과 API key는 `server-only` Claude client / App Route Handler에만 존재합니다. 작은 `max_tokens`(최대 320), 8초 abort/timeout, 모델 미지원 시 기본 모델 1회 재시도, 안전한 mock fallback을 사용합니다. raw provider error나 key는 응답에 포함하지 않습니다.

모든 endpoint는 `POST { taskTitle, taskDescription, sessionId }`를 받고 `session_id`도 호환합니다. UI는 탭별 UUID인 `getSessionId()`를 전달합니다. 공통 응답에는 `ok`, `provider: "mock" | "claude"`, `role`, `summary`가 있고, telemetry `traceRecorded`, `model`, `latencyMs`, `inputTokens`, `outputTokens`가 있을 수 있습니다. `debugReason`은 개발 환경에만 나옵니다.

| Route | 역할별 응답 필드 |
|-------|------------------|
| `/api/agents/planner` | `steps`, `risks`, `nextAgent` |
| `/api/agents/architect` | `architectureNotes`, `dataFlow`, `risks`, `nextAgent` |
| `/api/agents/developer` | `implementationPlan`, `filesToChange`, `testPlan`, `risks`, `nextAgent` |
| `/api/agents/reviewer` | `reviewFindings`, `suggestedChanges`, `risks`, `approvalStatus`, `nextAgent` |
| `/api/agents/qa` | `testCases`, `regressionChecks`, `qualityRisks`, `finalStatus`, `nextAgent` |

모델에는 markdown/code fence/설명 없는 raw JSON만 강하게 요청하며, 공통 parser는 accidental fence/prose를 제거한 뒤 `JSON.parse`합니다. parse 실패에만 안전한 역할별 fallback을 사용합니다. 잘못된 JSON body는 동일한 역할 shape와 `ok:false`로 400을 반환합니다.

**Plan with Claude**는 최고 우선순위 task를 계획하고, `steps`를 짧은 제목 + 원문 description의 하위 task로 바꿉니다. 명시적 `Architect에게` 우선, 역할 키워드 우선순위 및 `Developer/QA` 같은 복수 역할 분리를 지원합니다. `planner-generated` marker로 scripted sprint loop와 구분하며 handoff → agent 시작/상태 → 완료를 별도 처리합니다. Architect 생성 task는 자동 설계 검토를 시도하고, 각 specialist는 Task Queue 버튼에서 수동으로도 호출할 수 있습니다. 결과 요약/파일/테스트/승인 상태는 Event Log와 기존 Supabase events 경로에 기록됩니다.

### Claude 환경변수

```bash
ANTHROPIC_API_KEY=
ENABLE_LIVE_LLM=false
CLAUDE_MODEL=
SUPABASE_SERVICE_ROLE_KEY=
```

`ANTHROPIC_API_KEY`는 서버 전용입니다. `NEXT_PUBLIC_ANTHROPIC_API_KEY` 같은 브라우저 노출 변수는 만들지 않습니다.
`CLAUDE_MODEL`을 비워두면 서버 코드가 `claude-sonnet-4-20250514`를 사용합니다. 설정한 모델이 `model_not_found`로 실패하면 이 안정적인 기본 모델로 한 번 재시도합니다.
`SUPABASE_SERVICE_ROLE_KEY`도 서버 전용입니다. 모든 Agent route에서 `llm_call` trace를 안정적으로 저장할 때 우선 사용하며, 비어 있으면 서버에서 anon key로 fallback하고 `missing_service_role_key`만 경고합니다. 브라우저에는 절대 노출하지 않습니다.

### 실제 호출 켜기

`.env.local` 또는 Vercel Environment Variables에 아래처럼 설정합니다.

```bash
ANTHROPIC_API_KEY=sk-ant-...
ENABLE_LIVE_LLM=true
CLAUDE_MODEL=claude-sonnet-4-6
SUPABASE_SERVICE_ROLE_KEY=<supabase-service-role-key>
```

`ENABLE_LIVE_LLM=false`이거나 `ANTHROPIC_API_KEY`가 비어 있으면 항상 mock 응답을 반환합니다. live 호출은 비용이 발생할 수 있으므로 테스트할 때만 `true`로 바꾸세요.
Agent API 응답에서 `provider:"claude"`와 `traceRecorded:true`가 함께 나오면 live 호출과 `agent_traces.llm_call` 저장이 모두 성공한 상태입니다. 비용이 발생하므로 일반 개발/데모에서는 `false`를 유지하세요.

### Agent Trace 기록

`agent_traces` 테이블은 AgentOps 실제 연동 전까지 내부 관측 로그로 사용합니다. trace 저장은 실패해도 앱 흐름을 막지 않으며, API key/secret 같은 민감정보는 저장하지 않습니다.

| trace_type | 기록 시점 |
|------------|-----------|
| `llm_call` | 각 Agent가 서버 route에서 Claude live 호출에 성공했을 때 token/latency/model/task title 기록 (`SUPABASE_SERVICE_ROLE_KEY` 우선 사용) |
| `handoff` | Planner 응답 steps로 만든 하위 task를 담당 에이전트에게 넘길 때 기록 |
| `decision` | Planner-generated task를 담당 에이전트가 시작할 때 기록 |

이 구조는 나중에 AgentOps SDK를 붙일 때 동일한 trace 이벤트를 외부 관측 시스템으로 확장할 수 있도록 만든 scaffolding입니다. 현재는 OpenAI, AgentOps, LangGraph, CrewAI 실제 연결을 하지 않습니다.

trace 저장은 실패해도 Agent 응답과 UI workflow를 막지 않습니다 (`insertAgentTrace(): Promise<boolean>`). 실패 시 서버 로그에는 status code와 redacted response body만 출력되며, API key 값은 로그/응답/metadata에 남기지 않습니다. RLS 예시 및 production hardening 주의사항은 [`docs/supabase-schema.md`](docs/supabase-schema.md)를 참조하세요.

### Debug Panel & Agent Trace Correlation Debugger

우측 하단 **DEBUG & TRACE**를 열면 마지막 Agent 호출의 provider/role, `traceRecorded`, model, latency/token, KST 호출 시각과 Supabase `live` / `partial` / `error` 상태를 볼 수 있습니다. mock은 노란색이며 실패 시 **Trace not recorded**가 표시됩니다. 민감정보는 표시하지 않습니다.

내장 Trace Viewer는 Supabase `agent_traces` 최신 100개를 **Refresh**하고 즉시 생성된 local trace와 병합합니다. 연결/조회가 실패해도 local/mock trace로 계속 동작합니다. session을 선택하면 `session_id / agent_id / trace_type / task_title` 그룹, 시간순 timeline, `llm_call` / `handoff` / `decision` / `tool_use` badge, model/token/latency, Asia/Seoul `HH:mm:ss KST`, 안전한 metadata 요약, 관련 Task Queue/Event Log 조각/agent 상태를 함께 봅니다. metadata task title과 현재 task가 일치하면 Task Queue에서 강조됩니다.

자동 anomaly 규칙:
- `traceRecorded=false` (mock에서는 예상 상태라는 힌트 포함)
- Planner `handoff` 뒤 대상 agent `decision` 누락
- 완료된 Ask Agent 호출 뒤 관련 `llm_call` 누락
- `latency_ms >= 10000`
- metadata `approvalStatus` / `finalStatus`의 실패·추가조치 계열 값

각 anomaly는 안전한 한 줄 요약과 해결 힌트만 제공합니다. **Create Debug Finding**은 선택 session/anomaly signature마다 reviewer 또는 QA local-only task 1개와 local Event Log 1줄만 만들며 중복 생성하지 않습니다. Supabase에 쓰지 않습니다.

**Export Sanitized JSON**은 schema version 1 bundle을 내려받습니다. API key, bearer/JWT, service role, secret, password, credential처럼 보이는 key/value를 깊게 redaction하며 telemetry token *count*는 유지합니다. 그래도 export 전 내용을 검토하고 외부 공유를 최소화하세요. **Import Bundle**은 크기/JSON/schema/shape를 검사하고 손상·미지원 버전을 안전하게 거부합니다. 가져온 bundle은 read-only analysis mode의 timeline/anomaly 조회에만 사용되며 tasks/events/agent_traces에 쓰거나 finding을 만들지 않습니다.

### Operations Lens

상단 **Operations Lens**에서 agent role, task status, priority, trace type, session ID, free-text keyword를 조합하세요. 같은 상태가 Task Queue, Event Log, Trace Debugger에 적용되며 각 패널은 filtered/total count, 매칭 highlight, empty state와 **Clear all**을 제공합니다. 상태/우선순위/trace-type처럼 다른 패널에 직접 없는 필드는 task title/session/agent correlation으로 연결합니다. 결과는 원본 배열/DB를 바꾸지 않는 derived view이며 Reset 뒤 재설정되고 새 Plan 결과에서도 현재 데이터를 기준으로 재계산됩니다.

필터 결과상 관련 event/trace가 없는 task, session 불일치·누락, 담당 role 불일치가 있으면 Trace Debugger에 local-only **Lens warnings**가 표시됩니다. 이는 진단 힌트이며 저장되지 않고 secret을 포함하지 않습니다. Supabase 없이도 사용할 수 있습니다.

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
| `NEXT_PUBLIC_SUPABASE_URL` | 해당 프로젝트 Dashboard → Project Settings → API | 브라우저 클라이언트 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 해당 프로젝트 Dashboard → Project Settings → API Keys / Legacy API Keys → `anon` `public` | 브라우저 클라이언트 |
| `SUPABASE_SERVICE_ROLE_KEY` | 해당 프로젝트 Dashboard → Project Settings → API Keys / Legacy API Keys → `service_role` | 서버 전용 (`agent_traces.llm_call` insert 우선 키) |

`NEXT_PUBLIC_SUPABASE_ANON_KEY` 발급 위치: [Supabase Dashboard](https://supabase.com/dashboard)에서 **같은 프로젝트**를 선택 → **Project Settings** → **API Keys** (UI에 따라 **API**) → **Legacy API Keys** → `anon` / `public` JWT를 복사합니다. `NEXT_PUBLIC_SUPABASE_URL`도 동일 프로젝트의 URL이어야 합니다. 이 앱은 legacy anon JWT(`eyJ...`)를 기대합니다. `service_role`은 별도 서버 변수에만 넣으세요.

`sk-ant-...` 같은 Claude/Anthropic key, OpenAI key, service role key를 `NEXT_PUBLIC_*`에 넣으면 브라우저 번들에 노출되고 Supabase가 `Invalid API key`로 실패할 수 있습니다. 실수로 노출했다면 해당 key를 즉시 rotate하세요.

### 2. 스키마 적용

Supabase Dashboard → SQL Editor에서 [`docs/supabase-schema.md`](docs/supabase-schema.md)의 SQL을 순서대로 실행합니다.

### 3. 타입 재생성 (선택)

```bash
npx supabase gen types typescript --project-id <ref> > src/lib/supabase/types.ts
```

### 4. Vercel 배포

Vercel Dashboard → Project → Settings → Environment Variables에서 동일한 변수를 설정합니다.
`SUPABASE_SERVICE_ROLE_KEY`는 Production/Preview/Development 중 필요한 환경에 서버 전용으로 추가하고, `NEXT_PUBLIC_` prefix를 붙이지 않습니다.
`NEXT_PUBLIC_*` 값은 Next.js 클라이언트 빌드 시 치환되므로 변경 후 **Redeploy**가 필요합니다. 배포 후 화면 상단 **SUPABASE LIVE**와 Debug Panel 상태를 확인하세요. `provider:"claude"`인데 `traceRecorded:false`라면 Vercel Project → **Logs**에서 `/api/agents/<role>`를 필터하고 안전한 `missing_service_role_key`, `http_401/403`, RLS/table 오류를 확인하세요. key 원문은 로그에 붙여넣지 마세요.

---

## Next Roadmap

### 완료된 agent/observability foundation
- 5개 Agent route, 공통 raw JSON parser, timeout/fallback, mock-first gate
- Planner steps → 역할별 하위 task / handoff / decision workflow
- 서버 `llm_call` trace와 Debug Panel / Correlation Debugger / Operations Lens

### 다음 — AgentOps Tracing
- 기존 trace schema를 AgentOps 등 외부 관측 시스템으로 확장
- 에이전트 클릭 카드 Trace 섹션 실연결
- 실제 SDK 연동은 명시적으로 비용/보안 검토 후 진행

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
│   │                                      # 역할별 서버 전용 Claude/mock API route
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
│       ├── DebugPanel.tsx        # 마지막 Agent telemetry + correlation overlay
│       ├── OperationsLens.tsx    # 공통 read-only 운영 필터
│       ├── HighlightText.tsx
│       └── AgentTraceViewer.tsx  # 최근 100개/session timeline/bundle/anomaly
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
│   │   ├── prompts.ts        # 5개 역할별 시스템 프롬프트
│   │   ├── plannerStepAssignment.ts
│   │   └── askAgent.ts       # Task Queue Agent 호출/workflow
│   ├── llm/
│   │   ├── types.ts          # LLM provider/message/response/prompt 타입
│   │   ├── mockClaude.ts     # 비용 없는 Claude mock 응답
│   │   ├── claudeClient.ts   # 서버 전용 Claude SDK client + 안전 fallback
│   │   ├── json.ts           # raw JSON 정규화/parser
│   │   └── agentRoute.ts     # specialist server route 공통 처리
│   ├── debug/
│   │   ├── correlation.ts    # anomaly/correlation/sanitized bundle
│   │   ├── operationsLens.ts # read-only projection + warnings
│   │   └── clientTraces.ts   # local mirror + handoff/decision insert
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
│   ├── debugStore.ts         # telemetry/session/import/local trace 상태
│   └── operationsStore.ts    # 공통 Lens 필터 상태
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
| LLM | Anthropic SDK (`@anthropic-ai/sdk`) — 5개 서버 route live 옵션, 기본 mock |
| 관측성 | Supabase `agent_traces` + Trace Correlation Debugger / Operations Lens, AgentOps SDK 미연동 |
| 미래 워크플로우 | LangGraph / CrewAI — Phase 5 예정 |
