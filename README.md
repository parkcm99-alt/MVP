# AI Agent Office Simulator

픽셀아트 오피스에서 Planner, Architect, Developer, Reviewer, QA의 협업과 관측 데이터를 확인하는 Next.js MVP입니다.

## Current MVP Status

- 기존 MVP: Vercel Production, Supabase `events`/`agents`/`tasks` persistence, 멀티 브라우저 Realtime, KST Event Log, mock sprint simulation 경로를 유지합니다.
- Agent API: 5개 역할 모두 서버 전용 Claude/mock route와 구조화된 JSON 계약을 갖습니다.
- 비용 보호: `.env.example` 기본값은 `ENABLE_LIVE_LLM=false`이며 키가 없거나 live flag가 정확히 `true`가 아니면 네트워크 호출 없는 mock fallback을 사용합니다.
- Planner: 최고 우선순위 task 계획, 역할별 하위 task 분배/중복 억제, `handoff`/`decision` trace, 별도 mini workflow를 지원합니다.
- 관측: Debug Panel, 최근 100개 trace 기반 Trace Correlation Debugger, local-only anomaly/finding, sanitized bundle import/export를 지원합니다.
- 운영: Operations Lens가 Task Queue, Event Log, Trace Correlation에 동일한 read-only 필터를 적용합니다.
- Event Log는 저장 구조나 원본 배열을 자르지 않고 최신 200개만 렌더링합니다.
- OpenAI, AgentOps, LangGraph, CrewAI, 외부 tool 실행은 연결하지 않았습니다.

기존 Production/Supabase LIVE 상태는 프로젝트의 이전 배포 기준입니다. 환경변수나 접근 권한이 없는 별도 로컬 환경에서는 자동으로 MOCK MODE가 됩니다. 실제 Claude 호출은 비용이 발생하므로 의도적인 검증 시간에만 켜세요.

## 실행

```bash
npm ci
cp .env.example .env.local # Supabase/Claude가 필요할 때만 값 설정
npm run dev                # http://localhost:3000
npm run lint
npm run build
```

Supabase 없이도 화면, simulation, 5개 Ask Agent route, local trace/debugger, Lens를 사용할 수 있습니다.

## Agent API 및 비용 안전 장치

모든 호출은 App Router Route Handler에서 실행됩니다. `ANTHROPIC_API_KEY`와 `SUPABASE_SERVICE_ROLE_KEY`는 서버 전용이며 브라우저 번들이나 응답에 포함되지 않습니다. 공통 `src/lib/llm/claudeClient.ts`는 작은 `max_tokens`, abort/timeout, 모델 미지원 시 기본 모델 1회 재시도, 안전한 mock fallback을 제공합니다. provider 오류는 `model_not_found`, `invalid_api_key`, `insufficient_credit`, `network_error`, `json_parse_failed` 같은 안전한 이유만 경고합니다. `debugReason`은 development 응답에서만 보입니다.

`src/lib/agents/prompts.ts`에는 역할별 시스템 프롬프트가 있고, `src/lib/llm/json.ts`는 markdown/code fence 및 주변 설명을 제거한 뒤 JSON을 파싱합니다. 정상 JSON의 누락/잘못된 필드는 안전한 기본값으로 정규화하며, JSON.parse 실패 시만 결과 shape fallback을 사용합니다.

공통 요청은 `POST { taskTitle, taskDescription, sessionId }`입니다. UUID session을 사용하며 Planner는 `session_id`도 호환합니다. 응답은 항상 `ok`, `provider: 'mock' | 'claude'`, `role`, `summary`와 역할별 필드를 포함합니다. 안전 telemetry `traceRecorded`, `model`, `latencyMs`, `inputTokens`, `outputTokens`도 반환됩니다.

- `/api/agents/planner`: `steps`, `risks`, `nextAgent`
- `/api/agents/architect`: `architectureNotes`, `dataFlow`, `risks`, `nextAgent: developer | reviewer | qa`
- `/api/agents/developer`: `implementationPlan`, `filesToChange`, `testPlan`, `risks`, `nextAgent: reviewer | qa`
- `/api/agents/reviewer`: `reviewFindings`, `suggestedChanges`, `risks`, `approvalStatus: approved | changes_requested | needs_more_info`, `nextAgent: developer | qa`
- `/api/agents/qa`: `testCases`, `regressionChecks`, `qualityRisks`, `finalStatus: passed | failed | needs_more_testing`, `nextAgent: developer | reviewer | planner`

### 환경변수

```bash
# Browser-safe Supabase config
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Server-only; preferred for route-handler trace inserts
SUPABASE_SERVICE_ROLE_KEY=

# Server-only Claude config. Keep false by default.
ANTHROPIC_API_KEY=
ENABLE_LIVE_LLM=false
CLAUDE_MODEL=
```

`CLAUDE_MODEL`이 비어 있으면 `claude-sonnet-4-20250514`를 사용합니다. Live 호출은 `ENABLE_LIVE_LLM=true`와 유효한 Anthropic key가 모두 있을 때만 실행됩니다. `provider: 'claude'`와 `traceRecorded: true`는 해당 호출과 Supabase trace insert가 모두 성공했음을 뜻합니다. 키 없음, flag 비활성화, provider/네트워크 실패 시 기존 mock simulation은 계속 동작합니다.

## UI workflow

- **Start Sprint / Call Meeting / Add Task / Complete / Reset**: 기존 mock sprint controls입니다.
- **Plan with Claude**: 최고 우선순위 미완료 task를 Planner로 보냅니다. summary/steps는 Event Log와 Supabase planning event에 기록됩니다.
- Planner `steps`는 하위 task로 생성되고 Supabase `tasks`에 저장됩니다. 원문은 description에 보존하고 제목은 짧게 표시합니다. 명시적 `Architect에게`를 우선하며 설계/구조/데이터 흐름→Architect, 개발/API/코드→Developer, 리뷰/PR→Reviewer, 테스트/검증/품질→QA, 요구사항/기획/우선순위→Planner로 배정합니다. `Developer/QA` 같은 복수 역할은 가능하면 분리합니다.
- 같은 Planner 응답 fingerprint는 반복 task 생성을 억제합니다. `planner-generated` task는 기존 sprint loop와 분리되어 역할별 상태와 시작/완료 이벤트를 거친 뒤 `done`으로 persistence됩니다.
- Task Queue의 **Ask Architect / Developer / Reviewer / QA**는 해당 담당 task를 서버 route에 전달합니다. 결과는 역할별 사람이 읽을 수 있는 Event Log와 말풍선에 반영됩니다. Developer/Reviewer/QA도 live flag가 꺼져 있으면 mock입니다.
- Event Log 시간은 `Asia/Seoul` 기준입니다. DB `timestamptz`의 UTC 표시는 정상입니다.

## Supabase 설정 및 `Invalid API key` 확인

1. Supabase Dashboard에서 프로젝트를 선택합니다.
2. **Project Settings → API Keys**에서 **Publishable key**를 복사합니다. 레거시 프로젝트/화면이라면 **Legacy API Keys → anon public** JWT를 사용해도 됩니다. 이 값을 `NEXT_PUBLIC_SUPABASE_ANON_KEY`에 넣습니다.
3. Project URL은 **Project Settings → Data API/API**의 `https://<project-ref>.supabase.co` 값을 `NEXT_PUBLIC_SUPABASE_URL`에 넣습니다.
4. 서버 trace insert용 **secret/service_role** key는 같은 API Keys/Legacy API Keys 화면에서 찾아 `SUPABASE_SERVICE_ROLE_KEY`에만 넣습니다.
5. [`docs/supabase-schema.md`](docs/supabase-schema.md)의 테이블, Realtime publication, RLS SQL을 적용합니다.
6. Vercel에서는 **Project → Settings → Environment Variables**에 대상 환경(Production/Preview)에 맞춰 설정하고 재배포합니다. `NEXT_PUBLIC_*` 값은 build 시점에 브라우저 번들에 들어갑니다.

브라우저 key는 `sb_publishable_...` 또는 레거시 `eyJ...` anon JWT여야 합니다. Anthropic/OpenAI key, `sb_secret_...`, service_role key를 절대 `NEXT_PUBLIC_*`에 넣지 마세요. 잘못 노출한 secret은 즉시 rotate해야 합니다. `/api/agents/*`의 trace insert는 서버에서 service role key를 우선하고 없을 때만 anon/publishable key로 fallback하며 `missing_service_role_key`를 안전하게 경고합니다. 브라우저의 Realtime/tasks/events 및 trace 조회는 계속 public key를 사용합니다.

상단 연결 배지/Debug Panel 의미:

- `MOCK MODE`: Supabase public config 없음
- `SUPABASE LIVE` / `live`: 채널 구독 정상
- `PARTIAL ERR` / `partial`: 채널은 열렸지만 일부 persistence 실패
- `ERROR` / `config error`: 연결 또는 public config 실패

## Agent Traces 및 Debug Panel

`agent_traces`는 AgentOps 연결 전 내부 관측 테이블입니다. 실패는 `console.warn`만 남기고 앱/API 응답을 막지 않습니다. insert 유틸은 성공 `true`, 실패/skip `false`를 반환하고 status code와 redacted body만 경고합니다. prompt, API key, bearer token, service role key는 저장/표시하지 않습니다.

- `llm_call`: Planner/Architect/Developer/Reviewer/QA의 성공한 Claude 호출을 응답 전에 `await` 저장합니다. SDK usage token, model, latency, session, task title을 포함합니다.
- `handoff`: Planner가 생성 task를 담당 agent에 넘길 때 `source_agent`, `target_agent`, `task_title`을 기록합니다.
- `decision`: 담당 agent가 planner-generated task를 시작할 때 task/status/assigned role을 기록합니다.
- `tool_use`: 미래 확장용 badge/type입니다. 실제 tool/AgentOps 호출은 없습니다.

접이식 Debug Panel은 Supabase 상태, 마지막 agent/provider, 마지막 Plan 시각, `traceRecorded`, model, latency, input/output tokens를 보여줍니다. mock provider와 trace 미기록은 경고 색상으로 표시합니다. 이 schema는 나중에 AgentOps로 확장할 수 있지만 현재 SDK 연결은 없습니다.

## Trace Correlation Debugger

Debug Panel 안의 접이식 Trace Viewer는 Supabase 최근 100개와 안전한 local/mock trace를 `session_id`별 타임라인으로 묶습니다. 세션 카드에 agent/type/task 요약을 표시하고, 선택 시 KST `HH:mm:ss`, badge, model/token/latency/metadata 요약, 관련 Task Queue/Event Log 조각, agent 상태를 함께 보여줍니다. `task_title`이 매칭되는 현재 task는 Task Queue에서 강조됩니다. **Refresh**로 다시 조회할 수 있으며 Supabase 조회 실패 시에도 local 분석은 유지됩니다.

자동 anomaly 규칙:

- 응답/local metadata의 `traceRecorded: false`
- Planner `handoff` 뒤 대상 agent의 `decision` 누락
- Ask Agent 완료/실패 뒤 관련 `llm_call` 누락
- `latency_ms >= 10000`
- `finalStatus`/`approvalStatus`의 실패 또는 추가 조치 상태

각 anomaly는 민감정보 없는 한 줄 요약과 해결 힌트를 보여줍니다. **Create Debug Finding**은 선택 session/anomaly signature당 local-only Reviewer 또는 QA task 1개와 local Event Log 한 줄만 만들며, Supabase에 쓰지 않습니다.

### Sanitized bundle

**Export sanitized JSON**은 선택 session의 trace/call/context snapshot을 schema version 1로 내보냅니다. key/token/authorization/secret/service role로 보이는 key와 JWT, bearer, provider key 형태의 값은 재귀적으로 redaction됩니다. 그래도 export 파일은 운영 데이터 요약일 수 있으므로 신뢰할 수 없는 곳에 공유하지 마세요.

**Import bundle**은 크기, schema version, 배열 한도, 각 record shape를 검증하고 다시 sanitize한 뒤 **read-only analysis mode**에서만 엽니다. 손상 JSON/지원하지 않는 version은 안전한 오류로 거부합니다. Import 중에는 simulation 또는 Supabase `tasks`/`events`/`agent_traces`에 쓰지 않으며 finding 생성과 refresh가 비활성화됩니다. **Exit read-only**로 live/local view에 돌아갑니다.

## Operations Lens

상단 공통 Lens에서 agent role, task status, priority, trace type, session ID, keyword를 조합합니다. 한 상태가 Task Queue, Event Log, Trace Correlation에 동시에 적용되고 각 패널은 `filtered/total`, 매칭 텍스트 highlight, empty state, **Clear all**을 제공합니다. 필터는 배열을 변경하거나 Supabase에 저장하지 않는 derived view이며 Reset/새 Planner 결과 시 현재 상태에서 다시 계산됩니다.

관련 event/trace가 없는 task, session 불일치, agent role 불일치는 Debug Panel의 local-only **Lens warnings**로 요약됩니다. 경고는 진단 힌트일 뿐 DB를 수정하지 않으며 mock/Supabase 미연결 환경에서도 안전하게 동작합니다.

## 주요 파일

```text
src/app/api/agents/{planner,architect,developer,reviewer,qa}/route.ts
src/lib/llm/{types,mockClaude,claudeClient,json,agentRoute}.ts
src/lib/agents/{prompts,plannerStepAssignment}.ts
src/lib/supabase/{client,persistence,realtime,traces}.ts
src/lib/debug/{operationsLens,traceDebugger}.ts
src/components/debug/{OperationsLens,DebugPanel,AgentTraceViewer}.tsx
src/components/panels/{TaskQueue,EventLog}.tsx
src/store/{simulationStore,debugStore,lensStore}.ts
docs/supabase-schema.md
```

## Realtime 회귀 확인

Supabase가 설정된 서로 다른 브라우저/시크릿 창 2개에서 `SUPABASE LIVE`를 확인한 뒤 한쪽의 Start Sprint/Add Task/상태 변경이 다른 쪽 Event Log/Task Queue/Agent Status에 반영되는지 확인하세요. 동일 session echo는 기존 subscription 경로에서 제외됩니다. 환경변수가 없는 로컬에서는 MOCK MODE, Planner mini workflow, 모든 Ask Agent fallback, Debugger/Lens를 검증할 수 있습니다.

## 기술 스택

Next.js 16 App Router · React 19 · TypeScript · Zustand · Supabase Realtime · Anthropic SDK(server-only, opt-in) · React Flow · custom pixel CSS
