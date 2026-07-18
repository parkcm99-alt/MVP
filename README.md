# AI Agent Office Simulator

픽셀 오피스에서 Planner, Architect, Developer, Reviewer, QA의 협업을 시각화하는 Next.js MVP입니다. 기존 Supabase LIVE/Realtime 저장과 mock sprint simulation을 유지하면서, 모든 역할의 선택적 서버 전용 Claude 호출과 운영 디버깅 도구를 추가했습니다.

## 현재 상태

- 기존 MVP 기준 Vercel Production, Supabase `events`/`agents`/`tasks` 저장, 멀티 브라우저 Realtime 동기화가 구성되어 있습니다.
- Planner/Architect/Developer/Reviewer/QA API route가 준비되어 있으며 `ENABLE_LIVE_LLM=false`가 기본입니다. 활성화와 유효한 서버 key가 모두 있을 때만 Claude를 호출합니다.
- AgentOps, OpenAI, LangGraph, CrewAI는 연결하지 않았습니다. 일반 실행과 mock fallback은 LLM 비용을 발생시키지 않습니다.
- Event Log는 원본 저장 구조를 바꾸지 않고 최신 200개만 렌더링합니다.

## 실행 및 환경 변수

```bash
npm ci
cp .env.example .env.local
npm run dev
```

필수 Supabase 환경 변수:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase Dashboard → **Project Settings → API Keys**에서 발급합니다. Legacy API Keys의 `anon` public JWT 또는 새 `sb_publishable_...` publishable key를 사용하세요. 이 값은 브라우저용 public key입니다.
- `SUPABASE_SERVICE_ROLE_KEY` — 선택적 **서버 전용** key입니다. 서버의 `agent_traces` insert는 이를 우선 사용하며, 없으면 anon/publishable key로 fallback하고 `missing_service_role_key`를 경고합니다. 절대 `NEXT_PUBLIC_`로 노출하지 마세요.

선택적 Claude 환경 변수:

```env
ANTHROPIC_API_KEY=
ENABLE_LIVE_LLM=false
CLAUDE_MODEL=
```

브라우저에 Anthropic/service role key를 제공하지 마세요. Vercel 환경 변수를 수정한 뒤에는 Production을 다시 배포해야 public 변수가 빌드에 반영됩니다. `Invalid API key`가 발생하면 URL과 같은 프로젝트의 **anon/publishable** key인지, service role key가 server-only 변수에 들어갔는지, 값에 따옴표/공백이 없는지 확인하세요. RLS 및 SQL은 [`docs/supabase-schema.md`](docs/supabase-schema.md)를 참고하세요.

## Agent API와 workflow

모든 route는 POST `{ taskTitle, taskDescription, sessionId }`를 받습니다(Planner는 `session_id`도 허용). `ENABLE_LIVE_LLM !== 'true'`, key 누락, 안전한 호출 오류 또는 JSON 파싱 실패 시 mock으로 fallback합니다. SDK 호출은 `server-only` client에서만 수행하며 작은 token budget, timeout/abort, 모델 fallback, 안전한 경고를 사용합니다. 프롬프트는 raw JSON만 요청하고 공통 parser가 code fence/부가 텍스트를 제거합니다. raw 오류나 key는 응답에 노출하지 않습니다.

- `/api/agents/planner`: `summary`, `steps`, `risks`, `nextAgent`
- `/api/agents/architect`: `summary`, `architectureNotes`, `dataFlow`, `risks`, `nextAgent`
- `/api/agents/developer`: `summary`, `implementationPlan`, `filesToChange`, `testPlan`, `risks`, `nextAgent`
- `/api/agents/reviewer`: `summary`, `reviewFindings`, `suggestedChanges`, `risks`, `approvalStatus`, `nextAgent`
- `/api/agents/qa`: `summary`, `testCases`, `regressionChecks`, `qualityRisks`, `finalStatus`, `nextAgent`

응답에는 공통 `ok`, `provider: 'mock' | 'claude'`, `role`이 있고 telemetry(`traceRecorded`, `model`, `latencyMs`, `inputTokens`, `outputTokens`)를 사용할 수 있습니다. `debugReason`은 개발 환경에서만 노출됩니다. Task Queue의 **Ask Architect/Developer/Reviewer/QA**와 Action Bar의 **Plan with Claude**는 현재 session UUID를 사용하며 결과를 Event Log에 기록합니다.

Planner steps는 역할 키워드와 명시적 역할 우선순위로 배정합니다. 복수 역할은 가능하면 분리하고 짧은 title과 원문 description을 가진 하위 task를 생성합니다. planner-generated task는 별도 metadata로 구분되어 기존 mock sprint loop와 충돌하지 않고, 역할별 상태/시작 로그/완료 및 Supabase 반영 mini workflow를 진행합니다.

## Agent traces 및 Debug Panel

`agent_traces`는 민감정보 없이 다음 이벤트를 저장합니다.

- `llm_call`: 실제 Claude 성공 호출의 agent, session, model, usage tokens, latency
- `handoff`: Planner가 하위 task를 담당 agent에게 넘길 때
- `decision`: planner-generated task 처리 시작
- `tool_use`: 브라우저의 Ask 호출을 디버깅하기 위한 local trace

실패한 trace 저장은 안전한 `console.warn`과 `false`만 반환하며 앱을 중단하지 않습니다. 향후 AgentOps로 확장할 수 있지만 현재 연결하지 않습니다. 접이식 **Debug Panel**은 Supabase 상태, 마지막 역할/provider, trace 기록 여부, model, latency, token, 호출 시각을 보여줍니다. mock과 `Trace not recorded`는 경고로 표시하며 secret은 표시하지 않습니다.

## Trace Correlation Debugger

Debug Panel의 Viewer는 Supabase 최근 100개와 local trace를 session 기준으로 그룹화하고 agent/type/task 요약, KST `HH:mm:ss` 타임라인, `llm_call`·`handoff`·`decision`·`tool_use` badge 및 안전한 metadata를 표시합니다. Refresh와 session 선택으로 관련 Task Queue, Event Log 조각, agent 상태를 함께 확인할 수 있으며 일치하는 `task_title` task를 강조합니다. 연결이 없거나 조회에 실패해도 local/mock trace로 동작합니다.

자동 anomaly 규칙:

- `traceRecorded:false`
- Planner handoff 이후 해당 decision 누락
- Ask Agent 호출 이후 `llm_call` 누락
- `latency_ms >= 10000`
- metadata의 실패 계열 `finalStatus`/`approvalStatus`

각 항목은 안전한 한 줄 요약과 해결 힌트를 표시합니다. **Create Debug Finding**은 선택 session/anomaly signature당 중복 없이 reviewer 또는 QA local-only task와 Event Log 한 줄을 생성하며 Supabase에 저장하지 않습니다.

**Export Sanitized JSON Bundle**은 선택 session 진단 snapshot을 `schemaVersion: 1`로 내보냅니다. key/token/secret/bearer/JWT처럼 보이는 key/value를 재귀적으로 redaction하지만, 공유 전 내용은 직접 검토하세요. Import는 크기/구조/schema version을 검사하고 손상되거나 미지원 파일은 안전하게 거부합니다. Import된 bundle은 **read-only analysis mode**이며 timeline/anomaly 분석만 가능하고 Supabase tasks/events/traces에 쓰지 않습니다. Exit Import로 현재 session으로 돌아갑니다.

## Operations Lens

상단 공통 Lens에서 agent role, task status, priority, trace type, session ID, free-text keyword를 조합하세요. 동일한 read-only derived filter가 Task Queue, Event Log, Trace Correlation에 적용되고 각 패널은 filtered/total count, 텍스트 강조, empty state, **Clear all**을 제공합니다. Reset 또는 새 Planner workflow 후 현재 데이터로 재계산됩니다.

관련 task/event/trace 누락, session 불일치, agent 불일치는 **Lens warnings**로 로컬에서만 요약합니다. 이 경고는 진단용 휴리스틱이며 저장 구조나 원본 배열을 변경하지 않고 secret을 포함하지 않습니다. Supabase 미연결/mock 환경에서도 사용 가능합니다.

## 검증

```bash
npm run lint
npm run build
```

Production/live 검증에는 해당 Vercel 프로젝트 권한 및 Supabase/Anthropic 환경 변수가 필요합니다. 기본 mock 모드에서 UI와 모든 API fallback을 안전하게 확인할 수 있습니다.
