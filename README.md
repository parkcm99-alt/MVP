# AI Agent Office Simulator

픽셀아트 AI 에이전트 협업 오피스 MVP입니다. Planner, Architect, Developer, Reviewer, QA의 협업을 시뮬레이션하며, Supabase가 없을 때도 비용 없는 mock mode로 동작합니다.

## Current MVP Status

- Next.js 16 App Router + Zustand + Supabase `events`/`agents`/`tasks` persistence 및 Realtime 경로 유지
- Planner의 **Plan with Claude** → 역할별 하위 task 생성 → 별도 mini workflow → task 완료 경로
- Planner, Architect, Developer, Reviewer, QA 서버 전용 Claude/mock API route 완료
- 기본값 `ENABLE_LIVE_LLM=false`: API key가 없거나 live gate가 꺼져 있으면 절대 Claude를 호출하지 않음
- Debug Panel, 최근 100개 trace 기반 Trace Correlation Debugger, Operations Lens 완료
- Event Log는 원본 저장 구조를 자르지 않고 화면에서 최신 200개까지만 렌더링
- OpenAI / AgentOps / LangGraph / CrewAI 실제 연결은 **없음**

기존 Production/Supabase 배포 구성은 유지 대상입니다. 새 배포에는 아래 Supabase/Vercel 환경변수와 SQL 정책이 필요합니다. 환경을 설정하지 않은 로컬 실행은 정상적인 **MOCK MODE**입니다.

## Quick start

```bash
npm ci
cp .env.example .env.local  # 선택: Supabase 또는 live Claude를 사용할 때만
npm run dev                 # http://localhost:3000
npm run lint
npm run build
```

페이지는 자동 mock sprint loop를 시작합니다. **Pause**, **Start Sprint**, **Call Meeting**, **Add Task**, **Complete**, **Reset**으로 조작할 수 있습니다.

## Claude API 연결 준비 및 cost guard

```bash
# .env.local / Vercel Environment Variables
ANTHROPIC_API_KEY=
ENABLE_LIVE_LLM=false
CLAUDE_MODEL=
```

- `ANTHROPIC_API_KEY`와 `SUPABASE_SERVICE_ROLE_KEY`는 서버 전용입니다. `NEXT_PUBLIC_` prefix를 절대 붙이지 마세요.
- `ENABLE_LIVE_LLM=true` **그리고** Anthropic key가 있어야만 서버가 Claude를 호출합니다. 평소에는 `false`로 두세요. Live 호출은 비용이 발생할 수 있습니다.
- `CLAUDE_MODEL`이 비어 있으면 `claude-sonnet-4-20250514`를 사용합니다. 설정 모델이 지원되지 않을 때만 기본 모델로 한 번 fallback합니다.
- `src/lib/llm/claudeClient.ts`는 `server-only`이며 작은 `max_tokens`, timeout/abort, retry 제한, 안전한 mock fallback을 사용합니다. API key와 raw provider error는 클라이언트에 반환하지 않습니다.
- 안전한 진단 이유(예: `model_not_found`, `invalid_api_key`, `insufficient_credit`, `network_error`, `json_parse_failed`)만 경고합니다. `debugReason`은 개발환경에서만 응답에 포함됩니다.
- JSON parser(`src/lib/llm/json.ts`)는 raw JSON을 요구하고 불가피한 markdown/code fence를 제거합니다. 파싱 실패 시 구조화된 안전 fallback을 사용합니다.
- `src/lib/llm/mockClaude.ts`와 기존 sprint simulation은 네트워크/유료 호출이 없습니다.

### Agent routes

모든 route는 `POST { taskTitle, taskDescription, sessionId }`를 받습니다. `session_id`도 호환하며 UI는 탭별 UUID `getSessionId()`를 사용합니다. 응답은 항상 역할별 안정된 shape를 유지하고, telemetry (`traceRecorded`, `model`, `latencyMs`, `inputTokens`, `outputTokens`)를 포함할 수 있습니다.

- `/api/agents/planner`: `{ ok, provider, role:'planner', summary, steps, risks, nextAgent }`
- `/api/agents/architect`: `{ ok, provider, role:'architect', summary, architectureNotes, dataFlow, risks, nextAgent }`
- `/api/agents/developer`: `{ ok, provider, role:'developer', summary, implementationPlan, filesToChange, testPlan, risks, nextAgent }`
- `/api/agents/reviewer`: `{ ok, provider, role:'reviewer', summary, reviewFindings, suggestedChanges, risks, approvalStatus, nextAgent }`
- `/api/agents/qa`: `{ ok, provider, role:'qa', summary, testCases, regressionChecks, qualityRisks, finalStatus, nextAgent }`

`provider`는 `mock` 또는 `claude`입니다. Reviewer의 `approvalStatus`는 `approved | changes_requested | needs_more_info`, QA의 `finalStatus`는 `passed | failed | needs_more_testing`입니다. Architect/Developer/Reviewer/QA는 Task Queue의 **Ask Agent** 버튼으로 담당 task를 검토합니다. 결과 요약, 설계 노트/예상 파일/테스트 계획/승인 상태 등은 Event Log와 Supabase events 경로에 기록됩니다.

### Planner steps workflow

**Plan with Claude**는 가장 우선순위 높은 미완료 task를 Planner에 보냅니다. 응답 steps는 원문을 description에 보존하고 짧은 queue title로 나눕니다. 배정 유틸(`src/lib/agents/plannerStepAssignment.ts`)은 명시적인 `Architect에게`를 우선하며 설계/구조/데이터 흐름 → architect, 구현/API/코드 → developer, 리뷰/PR → reviewer, 테스트/회귀/품질 → qa, 요구사항/기획 → planner로 배정합니다. `Developer/QA`처럼 복수 역할이 명시되면 가능한 한 분리합니다.

Planner-generated task는 marker/source로 기존 mock sprint loop와 구분되고 같은 응답 fingerprint를 반복 생성하지 않습니다. 담당 agent는 thinking/coding/reviewing/testing workflow를 시작하고 `[Agent] 태스크 시작: ...` 로그를 남긴 뒤 `done`으로 완료합니다. 정상 task의 생성/완료는 Supabase `tasks`에도 반영됩니다.

## Supabase setup

Supabase 없이도 앱은 멈추지 않습니다. Persistence/Realtime을 사용하려면:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

1. Supabase Dashboard에서 프로젝트를 선택합니다.
2. **Project Settings → API** (새 Dashboard에서는 **API Keys → Legacy API Keys**)에서 Project URL과 `anon` / `public` **legacy JWT**를 복사합니다. 이 앱의 현재 browser validation은 `eyJ...` 형태의 legacy anon JWT를 기대합니다.
3. URL은 `NEXT_PUBLIC_SUPABASE_URL`, anon/public JWT는 `NEXT_PUBLIC_SUPABASE_ANON_KEY`에 넣습니다.
4. 같은 API 화면의 `service_role` legacy key는 필요한 경우 서버 전용 `SUPABASE_SERVICE_ROLE_KEY`에 넣습니다. 브라우저 변수, Git, screenshot, bundle에 넣지 마세요.
5. SQL Editor에서 [`docs/supabase-schema.md`](docs/supabase-schema.md)를 적용하고 `events`, `agents`, `tasks` Realtime publication을 확인합니다.
6. Vercel **Project → Settings → Environment Variables**에 해당 환경(Production/Preview)을 설정하고 **redeploy**합니다. `NEXT_PUBLIC_*` 값은 빌드 시 browser bundle에 반영됩니다.

`NEXT_PUBLIC_SUPABASE_ANON_KEY`는 Anthropic/OpenAI key나 service role key가 아닙니다. 잘못 넣으면 `Invalid API key` 또는 configuration error가 발생하며, 공개 변수에 secret을 넣었다면 즉시 rotate해야 합니다. 서버 trace insert는 service role key를 우선 사용하고 없으면 anon key로 fallback하면서 `missing_service_role_key`만 안전하게 경고합니다. 브라우저는 계속 anon key와 RLS를 사용합니다.

### Persistence 및 Realtime

```text
eventBus.emit → Zustand (즉시) → Supabase events INSERT
simulationStore → agents/tasks UPSERT
useRealtimeSync → 다른 session의 events/agents/tasks를 no-echo sync
```

- `events`는 append-only, `agents`는 `(id, session_id)` UPSERT, `tasks`는 `id` UPSERT입니다.
- speech, Lens filters, imported evidence, Debug Finding task/event는 local/transient이며 Supabase에 쓰지 않습니다.
- 두 브라우저 또는 시크릿 창에서 **SUPABASE LIVE**를 확인한 뒤 Add Task/Start Sprint로 Realtime을 확인할 수 있습니다.
- DB timestamps는 UTC `timestamptz`, 화면 Event Log/trace는 `Asia/Seoul` `HH:mm:ss KST`입니다.

## Agent Trace

`src/lib/supabase/traces.ts`의 `insertAgentTrace()`는 `Promise<boolean>`을 반환합니다. 실패/미설정은 `false`와 안전한 `console.warn`만 남기며 앱을 멈추지 않습니다. 민감정보 key/value는 저장/표시 전에 제거합니다.

- `llm_call`: 각 agent의 **성공한 Claude 호출** 직후 route가 `await`하여 `session_id`, SDK usage token, latency, model, 안전한 task/outcome metadata를 저장합니다.
- `handoff`: Planner가 생성 task를 담당 agent에게 넘길 때 `{ source_agent, target_agent, task_title }`
- `decision`: Planner-generated task 시작 시 `{ task_title, status, assigned_to }`
- `tool_use`: 향후 확장을 위해 badge/schema를 예약

Mock/fallback 호출도 Correlation Debugger에서 추적할 수 있도록 **local-only mirror**가 생기지만 원격 `llm_call` 성공을 가장하지 않습니다. `provider:'claude'`인데 `traceRecorded:false`이면 Supabase URL/key/RLS/service role 구성과 Vercel 서버 로그를 확인하세요. 정책 설명은 schema 문서의 RLS 절을 참고하세요. AgentOps SDK는 연결하지 않았으며, 이 trace shape는 추후 AgentOps로 확장할 수 있습니다.

## Debug Panel

우측 열의 접이식 Debug Panel은 다음을 표시합니다.

- Supabase: mock / connecting / live / partial / error
- 마지막 agent의 LLM provider 및 role (`mock`은 노란 경고)
- `traceRecorded` (`false`인 경우 **Trace not recorded**)
- last model, latency_ms, input_tokens, output_tokens
- 마지막 **Plan with Claude** 시간

API key, Authorization header, raw error는 표시하지 않습니다. 우측 열 자체를 스크롤하면 짧은 viewport에서도 Debug Panel과 Viewer에 접근할 수 있습니다.

## Agent Trace Viewer / Trace Correlation Debugger

Debug Panel 안의 접이식 Viewer는 Supabase `agent_traces` 최근 **100개**를 Refresh하고 local/mock mirror와 병합합니다. 연결/조회 실패 시에도 local evidence로 동작합니다. `session_id`별 session을 선택하면 agent, `trace_type`, task title(metadata) group, 시간순 timeline, 관련 Task Queue/Event Log 조각, 현재 agent 상태를 함께 보여줍니다. title이 일치하는 현재 task는 Queue에서 강조됩니다.

Timeline에는 `llm_call`, `handoff`, `decision`, `tool_use` badge 및 model, latency/token, sanitized metadata, `HH:mm:ss KST`가 표시됩니다.

### Anomaly rules

선택 session에서 다음을 local-only 분석합니다. 각 항목은 민감정보 없는 한 줄 요약과 해결 hint를 갖습니다.

- 응답/local metadata의 `traceRecorded:false`
- Planner `handoff` 뒤 target agent의 해당 `decision` 누락
- Ask/Plan button 호출 완료 뒤 대응하는 `llm_call` 누락
- `latency_ms >= 10000`
- metadata의 `approvalStatus` / `finalStatus`가 `changes_requested`, `needs_more_info`, `failed`, `needs_more_testing`

**Create Debug Finding**은 선택 session/anomaly signature당 reviewer 또는 qa task를 한 번만 만듭니다. task와 한 줄 Event Log는 **local-only**이며 Ask Agent/Supabase persistence 대상이 아닙니다. Refresh 지연 또는 진행 중인 mini workflow는 일시적으로 anomaly처럼 보일 수 있으므로 hint를 먼저 확인하세요.

### Sanitized JSON Bundle

선택 session을 **Export Sanitized JSON**으로 내보내고 **Import JSON**으로 다시 열 수 있습니다.

- schema `agent-office.trace-debug`, 현재 `schemaVersion: 1`, 최대 1 MB / 100 traces
- API key, bearer token, JWT, service role/secret처럼 보이는 key/value는 재귀적으로 제거/redact합니다. 그래도 bundle은 task/event 내용을 포함할 수 있으므로 공유 전 직접 검토하세요.
- 손상된 JSON, 지원하지 않는 version, 잘못된 session/shape/limit은 안전한 오류로 거부합니다.
- Import는 격리된 **read-only analysis mode**입니다. 해당 evidence로 Supabase tasks/events/traces를 쓰지 않으며 simulation과 Ask/action 버튼을 멈춥니다. **Exit Import** 후 명시적으로 Resume하세요.
- 원본 secret이나 전체 production dump를 import/export 용도로 사용하지 마세요.

## Operations Lens

상단 공통 Lens에서 **agent role**, **task status**, **priority**, **trace_type**, **sessionId/prefix**, **free-text keyword**를 조합합니다. Task Queue, Event Log, Trace Correlation timeline/session이 같은 read-only derived filter state를 사용하며 각각 `filtered/total` count, matching text highlight, empty state와 **Clear all**을 제공합니다.

원본 Zustand 배열, Supabase row/schema는 수정하지 않습니다. Reset/Plan 이후 derived 결과는 현재 데이터에서 다시 계산됩니다. Filtered task에 관련 event/trace가 없거나 title correlation의 session/role이 맞지 않으면 Debugger의 local-only **Lens warnings**가 요약합니다. 이는 진단 힌트이지 DB 오류가 아니며 민감정보를 포함하지 않습니다. Mock/offline mode에서도 사용할 수 있습니다.

## Structure

```text
src/app/api/agents/{planner,architect,developer,reviewer,qa}/route.ts
src/components/debug/{DebugPanel,AgentTraceViewer,OperationsLensBar,HighlightText}.tsx
src/components/panels/{TaskQueue,EventLog,AgentStatus}.tsx
src/hooks/{useRealtimeSync,useOperationsLens}.ts
src/lib/agents/{prompts,plannerStepAssignment,askAgent}.ts
src/lib/debug/{correlation,operationsLens,clientTraces}.ts
src/lib/llm/{types,mockClaude,claudeClient,json,agentRoute}.ts
src/lib/supabase/{client,persistence,realtime,traces,session,types}.ts
src/store/{simulationStore,debugStore}.ts
```

## Roadmap / non-goals

현재 구현은 안전한 single-agent server routes와 local/Supabase observability scaffolding입니다. Auth 기반 session isolation, tighter RLS, AgentOps, OpenAI, LangGraph, CrewAI, 실제 autonomous tool execution은 다음 단계이며 현재 연결되지 않습니다.
