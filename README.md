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
| Claude API Architect 1단계 | ✅ 서버 전용 route + Task Queue 버튼 연결 |
| Claude API Developer 1단계 | ✅ 서버 전용 route + Task Queue 버튼 연결 |
| Claude API Reviewer 1단계 | ✅ 서버 전용 route + Task Queue 버튼 연결 |
| Claude API QA 1단계 | ✅ 서버 전용 route + Task Queue 버튼 연결 |
| Plan with Claude workflow | ✅ steps → Task Queue 자동 생성 → 담당 에이전트 처리 |
| **Run Full Agent Flow** | ✅ Production 검증 완료 — 5단계 순차 실행, agent_traces 5개 저장 확인 |
| **Full Flow Summary Panel** | ✅ 실행 결과 요약 패널 — running/completed/failed 상태, 5 agent 요약, 토큰/레이턴시, 접기/펼치기 |
| **Final Report Generator** | ✅ Full Flow 결과 state 기반 최종 업무 보고서 생성 + Markdown Copy/Download/Print |
| **Work Request Input** | ✅ 업무 요청 직접 입력 → Full Flow 시작 입력으로 사용, 5초 cooldown, 실행 중 비활성화 |
| **UI Layout Refresh** | ✅ Top Command / Main Simulation / Right Tabs / Bottom Event Log 4영역 정리 |
| Planner task assignment | ✅ 역할 키워드 기반 분배 + 복수 역할 task 분리 |
| agent_traces 기록 | ✅ `llm_call` / `handoff` / `decision` insert 경로 구현 |
| Debug Panel | ✅ Supabase/provider/trace/token/latency 상태 표시 |
| Agent Trace Viewer | ✅ 최근 30개 trace 조회/수동 Refresh |

---

## 소개

5명의 AI 에이전트(Planner, Architect, Developer, Reviewer, QA)가 오피스에서 스프린트를 진행하는 모습을 픽셀아트로 시각화한 시뮬레이션입니다.

Planner, Architect, Developer, Reviewer, QA는 서버 전용 API route를 통해 Claude live 호출까지 연결되었습니다. AgentOps, OpenAI, LangGraph, CrewAI 실제 연동은 아직 하지 않았습니다.

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
- **Work Request 입력창** — ActionBar 상단에 위치한 업무 요청 textarea
  - 입력값이 있으면 버튼이 **⚡ Run Flow from Request**로 변경
  - 입력값을 `taskTitle: "User Work Request"`, `taskDescription: [입력 내용]`으로 전달
  - 비어 있으면 기존 최우선 task 기반으로 실행
  - Event Log에 `[FLOW] 사용자 요청 기반 Full Flow 시작` 등 입력 기반 로그 표시
  - Full Flow Summary Panel의 **Request** 항목에 원본 요청 표시
- **⚡ Run Full Flow / ⚡ Run Flow from Request** — Planner → Architect → Developer → Reviewer → QA 5단계 순차 실행
  - 각 단계 결과(summary + key arrays)를 다음 단계의 `taskDescription`으로 전달
  - Event Log에 `[FLOW]`, `[Planner]`, `[Architect]` 등 단계별 메시지 기록
  - Debug Panel에 각 단계 `provider`·`model`·`latencyMs`·`inputTokens`·`outputTokens` 업데이트
  - 완료 시 전체 누적 token + latency 요약을 Debug Panel `last flow`에 표시
  - 실행 중 버튼·입력창 비활성화("Running Flow..."), 완료 후 **5초 cooldown**("⏳ Wait 5s")
  - 개별 Agent 버튼은 호출 중 중복 클릭 차단 + 호출 후 **3초 cooldown**("Wait 3s")
  - 단계별 실패 시 Flow 중단 + failedAgent/failReason Summary 표시 + 해당 단계만 재시도 가능
  - mock fallback 사용 시 Event Log와 Summary `mockFallbackAgents`에 명확히 표시
  - 완료 시 Report 탭에서 최종 업무 보고서 자동 생성, Event Log에 `[REPORT] 최종 보고서 생성 완료` 표시
- **Complete Sprint** — 스프린트 완료 시퀀스
- **Reset** — 초기 상태로 복귀

### UI 레이아웃
- **Top Command Area** — Work Request 입력과 주요 Action Buttons를 상단에 배치
- **Main Simulation Area** — Pixel Office를 중앙 메인 영역으로 유지
- **Right Control Panel** — `Tasks` / `Summary` / `Report` / `Debug` / `Traces` 탭으로 Task Queue, Full Flow Summary, Final Report, Debug Panel, Agent Trace Viewer를 분리
- **Bottom Event Log** — 화면 하단 전체 폭 접이식 로그 패널, 최신 200개 렌더링 제한 유지
- 패널 제목, 카드 여백, 버튼 간격, 로그 타입 배지를 키워 가독성을 개선

### 사이드 패널
- **Tasks 탭** — Workflow Graph, Task Queue, Agent Status 표시
- **Task Queue** — 태스크 상태(backlog/in-progress/review/done)·담당자 표시
- Architect 담당 task에는 **Ask Architect** 버튼으로 Claude/mock 설계 검토 요청 가능
- Developer 담당 task에는 **Ask Developer** 버튼으로 Claude/mock 구현 계획 요청 가능
- Reviewer 담당 task에는 **Ask Reviewer** 버튼으로 Claude/mock 코드 리뷰 요청 가능
- QA 담당 task에는 **Ask QA** 버튼으로 Claude/mock 테스트 계획 요청 가능
- **Agent Status** — 에이전트별 현재 상태·현재 태스크·완료 수
- **Event Log** — 하단 전체 폭 실시간 이벤트 스트림 (KST 시간 표시, 접기/펼치기)
- Event Log는 성능 보호를 위해 최신 200개까지만 렌더링
- **Workflow Graph** — Planner→Architect→Developer→Reviewer→QA React Flow 그래프 (활성 노드 하이라이트, QA→Dev 버그 엣지)
- **Summary 탭** — Full Flow Summary Panel 표시. Run Full Flow 실행 후 표시됨
  - `running` (amber) · `completed` (green) · `failed` (red) 상태 배지
  - 5개 에이전트별 summary 텍스트, Reviewer `approvalStatus` badge, QA `finalStatus` badge
  - `totalInputTokens` · `totalOutputTokens` · `totalTokens` · `totalLatencyMs` 메트릭 그리드
  - 완료 시각 KST `HH:mm:ss` 표시
  - 실패 시: 실패한 에이전트명, 실패 사유, 완료된 에이전트 목록, **Retry Failed Agent** 버튼 표시
  - mock fallback 발생 시 사용된 에이전트 목록 표시
- **Report 탭** — Final Report Generator 표시. 추가 Claude 호출 없이 Full Flow state만 조합
  - Original Request, Executive Summary, Agent별 요약, Final Recommendation, Next Actions 표시
  - summary 안의 JSON string/code fence를 정리하고 배열 값은 bullet list로 표시
  - Reviewer `approvalStatus`와 QA `finalStatus`를 반영해 “진행 가능 / 추가 검증 후 진행 / 수정 후 재검토 / 수정 요청 반영 필요 / 추가 정보 필요” 권고 생성
  - **Copy Report** 버튼으로 Markdown 보고서를 클립보드에 복사
  - **Download MD** 버튼으로 `ai-agent-report.md` 다운로드
  - **Print** 버튼으로 브라우저 인쇄 실행
- **Debug 탭** — Supabase 상태, 마지막 LLM agent/provider, traceRecorded, model, latency/token 표시 (접기/펼치기, mock/trace 실패 경고 표시)
- **Traces 탭** — Agent Trace Viewer에서 `agent_traces` 최근 30개를 조회하고 `llm_call`/`handoff`/`decision`/`tool_use` badge, KST 시간, token/latency, metadata 요약 표시

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

## Claude API Planner Stage 1

> Planner 에이전트만 서버 전용 API route로 Claude live 호출을 사용할 수 있습니다. 기본값은 비용 방지를 위해 mock fallback입니다.

| 항목 | 상태 |
|------|------|
| `@anthropic-ai/sdk` dependency | ✅ 추가 |
| Planner API route | ✅ `POST /api/agents/planner` |
| Architect API route | ✅ `POST /api/agents/architect` |
| Developer API route | ✅ `POST /api/agents/developer` |
| Reviewer API route | ✅ `POST /api/agents/reviewer` |
| QA API route | ✅ `POST /api/agents/qa` |
| 요청 body | ✅ `{ taskTitle, taskDescription, sessionId }` (`session_id`도 호환) |
| 응답 형식 | ✅ agent별 JSON shape + `traceRecorded`/model/token/latency telemetry |
| live 호출 gate | ✅ `ENABLE_LIVE_LLM=true` + `ANTHROPIC_API_KEY` 필요 |
| 기본 동작 | ✅ `ENABLE_LIVE_LLM=false` 이면 mock fallback |
| 서버 전용 키 | ✅ `ANTHROPIC_API_KEY`는 `NEXT_PUBLIC_` 없이 서버에서만 사용 |
| Planner UI 테스트 | ✅ ActionBar `Plan with Claude` 버튼 |
| Supabase events 저장 | ✅ `agent.planning` 이벤트로 summary/steps 저장 시도, 실패해도 앱 유지 |
| Task Queue 반영 | ✅ Planner steps 기반 하위 task 자동 생성 |
| Mini workflow | ✅ assigned agent 상태 변경 → task done 처리 |
| Trace 기록 | ✅ Claude 성공 시 `llm_call`, task handoff/start 시 `handoff`/`decision` |
| Architect trace 기록 | ✅ Claude 성공 시 `agent_id="architect"` `llm_call` |
| Developer trace 기록 | ✅ Claude 성공 시 `agent_id="developer"` `llm_call` |
| Reviewer trace 기록 | ✅ Claude 성공 시 `agent_id="reviewer"` `llm_call` |
| QA trace 기록 | ✅ Claude 성공 시 `agent_id="qa"` `llm_call` |
| Debug Panel | ✅ 마지막 LLM 응답의 agent/provider/trace/model/token/latency 표시 |
| Agent Trace Viewer | ✅ Supabase `agent_traces` 최근 30개 조회 + Refresh |
| LLM 공통 타입 | ✅ `src/lib/llm/types.ts` |
| Mock Claude 응답 | ✅ `src/lib/llm/mockClaude.ts` — 네트워크/API 호출 없음 |
| Claude client | ✅ `src/lib/llm/claudeClient.ts` — `server-only`, timeout/max token 제한, 안전 fallback |
| 역할별 시스템 프롬프트 | ✅ `src/lib/agents/prompts.ts` |
| OpenAI / AgentOps / LangGraph / CrewAI 실연결 | 🚫 아직 비활성화 |

### Claude 환경변수

```bash
ANTHROPIC_API_KEY=
ENABLE_LIVE_LLM=false
CLAUDE_MODEL=claude-sonnet-4-6
CLAUDE_TIMEOUT_MS=15000
SUPABASE_SERVICE_ROLE_KEY=
```

`ANTHROPIC_API_KEY`는 서버 전용입니다. `NEXT_PUBLIC_ANTHROPIC_API_KEY` 같은 브라우저 노출 변수는 만들지 않습니다.
`CLAUDE_MODEL`을 비워두면 서버 코드가 `claude-sonnet-4-6`를 사용합니다. 설정한 모델이 `model_not_found`로 실패하면 이 안정적인 기본 모델로 한 번 재시도합니다.
`CLAUDE_TIMEOUT_MS`는 서버 route의 Claude 요청 제한 시간입니다. 기본값은 15000ms이고, 운영 중 Sonnet 역할이 timeout으로 mock fallback되는 경우 Vercel Production env에서 조정할 수 있습니다.
`SUPABASE_SERVICE_ROLE_KEY`도 서버 전용입니다. Production의 agent API route에서 `llm_call` trace를 안정적으로 저장할 때 우선 사용하며, 브라우저에는 절대 노출하지 않습니다.

### 역할별 모델 설정

각 에이전트가 사용할 모델을 독립적으로 지정할 수 있습니다. 모델 선택 우선순위는 아래와 같습니다.

```
CLAUDE_<ROLE>_MODEL  →  역할별 내장 기본값  →  CLAUDE_MODEL  →  claude-sonnet-4-6
```

| 환경변수 | 적용 에이전트 | 기본값 (미설정 시) |
|----------|--------------|-------------------|
| `CLAUDE_PLANNER_MODEL` | Planner | `CLAUDE_MODEL` 상속 |
| `CLAUDE_ARCHITECT_MODEL` | Architect | `CLAUDE_MODEL` 상속 |
| `CLAUDE_DEVELOPER_MODEL` | Developer | `CLAUDE_MODEL` 상속 |
| `CLAUDE_REVIEWER_MODEL` | Reviewer | `claude-haiku-4-5-20251001` |
| `CLAUDE_QA_MODEL` | QA | `claude-haiku-4-5-20251001` |

**명시적 비용 최적화 예시** — Vercel Environment Variables에서도 아래처럼 명시할 수 있습니다.

```bash
# .env.local 또는 Vercel Environment Variables
CLAUDE_REVIEWER_MODEL=claude-haiku-4-5-20251001
CLAUDE_QA_MODEL=claude-haiku-4-5-20251001
```

실제 호출에 사용된 모델명은 `agent_traces.model` 필드와 Debug Panel / Agent Trace Viewer에 그대로 표시됩니다.

### 실제 호출 켜기

`.env.local` 또는 Vercel Environment Variables에 아래처럼 설정합니다.

```bash
ANTHROPIC_API_KEY=sk-ant-...
ENABLE_LIVE_LLM=true
CLAUDE_MODEL=claude-sonnet-4-6
SUPABASE_SERVICE_ROLE_KEY=<supabase-service-role-key>
```

`ENABLE_LIVE_LLM=false`이거나 `ANTHROPIC_API_KEY`가 비어 있으면 항상 mock 응답을 반환합니다. live 호출은 비용이 발생할 수 있으므로 테스트할 때만 `true`로 바꾸세요.
Agent API 응답에서 `provider:"claude"`와 `traceRecorded:true`가 함께 나오면 Claude live 호출과 `agent_traces.llm_call` 저장이 모두 성공한 상태입니다.

### Agent Trace 기록

`agent_traces` 테이블은 AgentOps 실제 연동 전까지 내부 관측 로그로 사용합니다. trace 저장은 실패해도 앱 흐름을 막지 않으며, API key/secret 같은 민감정보는 저장하지 않습니다.

| trace_type | 기록 시점 |
|------------|-----------|
| `llm_call` | Planner/Architect/Developer/Reviewer/QA가 서버 route에서 Claude live 호출에 성공했을 때 token/latency/model 기록 (`SUPABASE_SERVICE_ROLE_KEY` 우선 사용) |
| `handoff` | Planner 응답 steps로 만든 하위 task를 담당 에이전트에게 넘길 때 기록 |
| `decision` | Planner-generated task를 담당 에이전트가 시작할 때 기록 |

이 구조는 나중에 AgentOps SDK를 붙일 때 동일한 trace 이벤트를 외부 관측 시스템으로 확장할 수 있도록 만든 scaffolding입니다. 현재는 OpenAI, AgentOps, LangGraph, CrewAI 실제 연결을 하지 않습니다.

trace 저장은 실패해도 Planner 응답과 UI workflow를 막지 않습니다. 실패 시 Vercel Logs에는 status code와 redacted response body만 출력되며, API key 값은 로그/응답/metadata에 남기지 않습니다.

### Agent Trace Viewer

Debug Panel에는 접이식 Agent Trace Viewer가 포함되어 있습니다. 브라우저 Supabase client로 `agent_traces` 최신 30개만 조회하며, 수동 **Refresh** 버튼으로 다시 불러올 수 있습니다.

표시 항목은 `trace_type`, `agent_id`, `model`, `latency_ms`, `input_tokens`, `output_tokens`, `created_at`(Asia/Seoul `HH:mm:ss KST`), metadata 요약입니다. metadata는 key/token/secret/password 등 민감정보로 보이는 필드를 표시하지 않습니다.

---

## Work Request Input 사용법

ActionBar 상단에 업무 요청 입력창이 있습니다.

### 기본 사용 흐름

1. **입력창에 업무 요청을 작성합니다**
   ```
   예: 이디야 파일럿 운영 현황을 정리하고, 리스크와 다음 액션을 뽑아줘.
   ```
2. **⚡ Run Flow from Request 버튼을 클릭합니다**
   - 입력값이 있으면 버튼 텍스트가 자동으로 바뀝니다
   - 입력값이 없으면 기존 최우선 task 기반으로 실행합니다

3. **실행 흐름**
   - `taskTitle: "User Work Request"`, `taskDescription: [입력 내용]`을 Planner에 전달
   - Planner → Architect → Developer → Reviewer → QA 순차 실행
   - Event Log에 `[FLOW] 사용자 요청 기반 Full Flow 시작` + 단계별 로그 표시
   - Full Flow Summary Panel **Request** 항목에 원본 요청 텍스트 표시

4. **완료 후**
   - Full Flow Summary Panel에서 5개 에이전트 결과를 확인합니다
   - Report 탭에서 최종 업무 보고서를 확인하고 **Copy Report** / **Download MD** / **Print**를 사용할 수 있습니다
   - 5초 cooldown(버튼에 "⏳ Wait 5s" 표시) 후 다시 실행 가능합니다
   - 입력창을 수정해 다른 요청으로 재실행할 수 있습니다

### Final Report Generator

Run Full Flow가 `completed` 상태가 되면 추가 Claude API 호출 없이 클라이언트 state만으로 최종 보고서를 생성합니다.

보고서 구성:

- 제목과 Original Request
- Executive Summary
- Planner / Architect / Developer / Reviewer / QA 요약
- JSON 문자열이나 code fence가 섞인 응답은 사람이 읽는 문장과 bullet list로 정리
- Reviewer `approvalStatus`와 QA `finalStatus` 기반 Final Recommendation
- Agent 요약에서 추출한 Next Actions, 없으면 기본 후속 작업 3개
- 하단 운영 정보: `totalInputTokens`, `totalOutputTokens`, `totalTokens`, `totalLatencyMs`, 완료 시각

`Copy Report`는 위 내용을 Markdown 형식으로 클립보드에 복사합니다. `Download MD`는 `ai-agent-report.md` 파일로 저장하고, `Print`는 `window.print()` 기반으로 브라우저 인쇄를 실행합니다. Supabase DB 구조는 변경하지 않습니다.

### 동작 상세

| 조건 | 버튼 텍스트 | 동작 |
|------|------------|------|
| 입력 없음 + 대기 | ⚡ Run Full Flow | 현재 최우선 task 기반 실행 |
| 입력 있음 + 대기 | ⚡ Run Flow from Request | 입력 내용 기반 실행 |
| 실행 중 | Running Flow... (비활성) | 입력창도 비활성화 |
| Cooldown 중 | ⏳ Wait 5s (비활성) | 입력창은 수정 가능 |

### 비용/호출 제한 안정화

- Full Flow 실행 중에는 Run Full Flow 버튼과 Work Request 입력창이 비활성화되어 중복 실행을 막습니다.
- Full Flow 종료 후 5초 동안 재실행할 수 없고, Planner/Architect/Developer/Reviewer/QA 개별 버튼은 호출 후 3초 동안 `Wait 3s` 상태가 됩니다.
- 같은 Agent가 이미 호출 중이면 해당 Agent 버튼은 `Busy...` 또는 실행 중 상태로 잠겨 연속 클릭 비용을 방지합니다.
- 특정 단계 실패 시 남은 단계는 중단되고, Event Log와 Full Flow Summary에 failedAgent/failReason이 남습니다.
- Summary의 **Retry Failed Agent** 버튼은 실패한 Agent API만 다시 호출하며, 성공하면 Summary와 Debug Panel의 token/latency/provider 값이 갱신됩니다.
- `provider:"mock"` fallback이 발생하면 Event Log에 `[FLOW] Agent used mock fallback` 로그가 남고 Summary에도 `mockFallbackAgents`로 표시됩니다.
- Supabase DB 구조는 변경하지 않고 UI state와 기존 `agent_traces` 기록만 사용합니다.

---

## Run Full Agent Flow — Production Verification

> Vercel 배포 환경에서 검증 완료 (2026-04-30)

### 검증 항목

| 항목 | 결과 |
|------|------|
| ⚡ Run Full Flow 버튼 표시 | ✅ ActionBar에 amber 테마 버튼 표시 |
| 실행 중 상태 표시 | ✅ "Running Flow..." 텍스트 + 버튼 비활성화 |
| Planner → Architect → Developer → Reviewer → QA 순차 실행 | ✅ 확인 |
| Event Log `[FLOW] Full Agent Flow 시작` 표시 | ✅ 확인 |
| Event Log 단계별 `[Planner]` `[Architect]` `[Developer]` `[Reviewer]` `[QA]` 로그 | ✅ 확인 |
| Debug Panel 단계별 provider/model/token/latency 갱신 | ✅ 확인 |
| Agent Trace Viewer에 5개 `llm_call` trace 표시 | ✅ 확인 |
| Supabase `agent_traces`에 planner/architect/developer/reviewer/qa `llm_call` 저장 | ✅ 확인 |
| 완료 후 Debug Panel `last flow` 누적 token/latency 요약 표시 | ✅ 확인 |
| Full Flow Summary Panel — running/completed/failed 상태 + 5 agent 요약 | ✅ 구현 완료 |
| Summary Panel 접기/펼치기 | ✅ 구현 완료 |
| 실패 시 failedAgent · failReason · completedAgents 표시 | ✅ 구현 완료 |
| Event Log 최종 요약 메시지 `[FLOW] 전체 실행 완료 — QA / Reviewer / total tokens` | ✅ 구현 완료 |

### 참고사항

- 첫 실행에서 일시적으로 특정 agent가 mock fallback될 수 있으나, API 단독 호출과 재실행에서 정상 확인됨
- Production 검증은 Vercel 배포 환경변수(`ENABLE_LIVE_LLM=true`, `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) 기준으로 수행됨
- 로컬 `.env.local`의 Supabase URL이 Production과 다를 경우, 로컬에서 직접 `agent_traces` 조회가 실패할 수 있음 (Production DB를 가리키도록 설정하면 조회 가능)

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
- Architect / Developer / Reviewer / QA API route 1단계 완료 (Task Queue 버튼 + trace 기록)
- Planner 응답 steps → Task Queue 자동 생성 완료
- Planner-generated task mini workflow 완료
- 다음 단계: 에이전트 클릭 카드 Trace 섹션 실연결 또는 전체 agent workflow 자동 orchestration

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
│   │   └── agents/
│   │       ├── planner/route.ts     # Planner 서버 전용 Claude/mock API route
│   │       ├── architect/route.ts   # Architect 서버 전용 Claude/mock API route
│   │       ├── developer/route.ts   # Developer 서버 전용 Claude/mock API route
│   │       ├── reviewer/route.ts    # Reviewer 서버 전용 Claude/mock API route
│   │       └── qa/route.ts          # QA 서버 전용 Claude/mock API route
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
│       ├── DebugPanel.tsx        # 마지막 LLM provider/trace/token/latency 디버그 패널
│       └── AgentTraceViewer.tsx  # agent_traces 최근 30개 조회/표시
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
│   ├── simulationStore.ts    # Zustand 스토어
│   └── debugStore.ts         # Supabase / LLM debug 상태
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
| LLM | Anthropic SDK (`@anthropic-ai/sdk`) — 5-agent route live 옵션, 기본 mock |
| 관측성 | Supabase `agent_traces` + Agent Trace Viewer — `llm_call`/`handoff`/`decision`, AgentOps SDK는 미연동 |
| 미래 워크플로우 | LangGraph / CrewAI — Phase 5 예정 |
