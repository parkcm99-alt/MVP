# Supabase Schema Design

AI Agent Office Simulator — 데이터베이스 설계

> **실행 순서**: 아래 SQL을 Supabase SQL Editor에서 순서대로 실행하세요.

---

## 0. 공통 함수

`moddatetime` 익스텐션 없이 `updated_at`을 자동 갱신하는 트리거 함수입니다.
모든 `updated_at` 트리거에서 사용합니다.

```sql
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
```

---

## 1. `agents`

에이전트 5명의 실시간 상태를 session별로 저장.
Supabase Realtime postgres_changes를 통해 프론트엔드에 브로드캐스트.

```sql
create table public.agents (
  id              text        not null,  -- AgentRole: 'planner' | 'architect' | ...
  session_id      uuid        not null,
  name            text        not null,
  emoji           text        not null,
  status          text        not null default 'idle',
  current_task    text,
  position_x      integer     not null default 0,
  position_y      integer     not null default 0,
  completed_tasks integer     not null default 0,
  updated_at      timestamptz not null default now(),

  primary key (id, session_id)
);

create trigger agents_updated_at
  before update on public.agents
  for each row execute function public.set_updated_at();

alter publication supabase_realtime add table public.agents;
```

---

## 2. `tasks`

스프린트 태스크 목록. status 컬럼 변경이 TaskQueue에 실시간 반영.

```sql
create table public.tasks (
  id          uuid        primary key default gen_random_uuid(),
  session_id  uuid        not null,
  title       text        not null,
  description text        not null default '',
  assigned_to text,                   -- AgentRole (nullable)
  status      text        not null default 'backlog',  -- backlog | in_progress | review | done
  priority    text        not null default 'medium',   -- low | medium | high
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index tasks_session_id on public.tasks (session_id);
create index tasks_assigned_to on public.tasks (assigned_to);

create trigger tasks_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

alter publication supabase_realtime add table public.tasks;
```

---

## 3. `events`

시뮬레이션 이벤트 로그. append-only — UPDATE / DELETE 없음.

```sql
create table public.events (
  id          uuid        primary key default gen_random_uuid(),
  session_id  uuid        not null,
  agent_id    text        not null,   -- AgentRole
  agent_name  text        not null,
  agent_color text        not null,
  type        text        not null,   -- task | meeting | chat | system | review | planning
  message     text        not null,
  metadata    jsonb,                  -- 자유 형식 추가 데이터
  timestamp   timestamptz not null default now()
);

create index events_session_id      on public.events (session_id);
create index events_agent_id        on public.events (agent_id);
create index events_timestamp       on public.events (timestamp desc);

alter publication supabase_realtime add table public.events;
```

---

## 4. `agent_traces`

내부 Agent Trace 테이블입니다. AgentOps/OpenAI/LangGraph/CrewAI는 아직 연결하지 않으며, 현재 앱은 Claude 서버 호출과 Planner handoff/decision만 best-effort로 기록합니다. Trace Viewer는 최근 100개를 읽습니다.

```sql
create table public.agent_traces (
  id            uuid        primary key default gen_random_uuid(),
  session_id    uuid        not null,
  agent_id      text        not null,   -- AgentRole
  trace_type    text        not null,   -- 'llm_call' | 'tool_use' | 'handoff' | 'decision'
  input_tokens  integer,
  output_tokens integer,
  latency_ms    integer,
  model         text,                   -- 'claude-sonnet-4-6' etc.
  metadata      jsonb,
  created_at    timestamptz not null default now()
);

create index agent_traces_session_id on public.agent_traces (session_id);
create index agent_traces_agent_id   on public.agent_traces (agent_id);
```

---

## 5. Row Level Security (RLS)

```sql
-- agents
alter table public.agents  enable row level security;
create policy "anon read"   on public.agents  for select using (true);
create policy "anon insert" on public.agents  for insert with check (true);
create policy "anon update" on public.agents  for update using (true);

-- tasks
alter table public.tasks   enable row level security;
create policy "anon read"   on public.tasks   for select using (true);
create policy "anon insert" on public.tasks   for insert with check (true);
create policy "anon update" on public.tasks   for update using (true);

-- events: insert 필수 — 클라이언트가 anon key로 이벤트를 저장
alter table public.events  enable row level security;
create policy "anon read"   on public.events  for select using (true);
create policy "anon insert" on public.events  for insert with check (true);

-- agent_traces: MVP 브라우저 handoff/decision insert + Viewer select
-- 서버 llm_call은 SUPABASE_SERVICE_ROLE_KEY를 우선 사용합니다.
-- API key/secret은 저장하지 않고, update/delete는 열지 않습니다.
alter table public.agent_traces enable row level security;
create policy "anon read"   on public.agent_traces for select using (true);
create policy "anon insert" on public.agent_traces for insert with check (true);
```

### `agent_traces` RLS 및 키 경계

- 서버 Route Handler의 `llm_call`은 `SUPABASE_SERVICE_ROLE_KEY`를 우선 사용합니다. Service role은 RLS를 우회하므로 서버 환경변수로만 설정하고 절대 `NEXT_PUBLIC_` prefix나 브라우저/번들/metadata에 넣지 않습니다.
- 서비스 키가 없으면 서버는 `NEXT_PUBLIC_SUPABASE_ANON_KEY`로 fallback하고 `missing_service_role_key`만 경고합니다. 이때 위 `anon insert` 정책이 없으면 `traceRecorded:false`가 됩니다.
- 브라우저는 public anon/publishable key로 `handoff`/`decision`을 insert하고 Trace Correlation Debugger에서 select합니다. 따라서 현재 MVP에서는 `anon read`와 `anon insert`가 필요하며 update/delete 정책은 만들지 않습니다.
- 이 공개 RLS는 인증 없는 데모용입니다. Production 사용자 데이터에는 그대로 사용하지 말고 Supabase Auth + `auth.uid()` 기반 session 소유권 정책 또는 서버 중계로 교체하세요. Trace metadata에는 task 제목·role·outcome 같은 최소 정보만 넣습니다.
- `llm_call`, `handoff`, `decision` insert 실패는 `Promise<boolean>`의 `false`와 안전한 status/body 경고로 처리되며 시뮬레이션을 멈추지 않습니다. `tool_use` badge는 확장용이며 아직 외부 도구 연결은 없습니다.

### Public key 발급 위치

Supabase Dashboard에서 대상 프로젝트를 선택한 뒤 **Project Settings → API**(새 UI는 **Settings → API Keys**)로 이동합니다. **Project URL**을 `NEXT_PUBLIC_SUPABASE_URL`에 넣고, **Legacy API Keys → anon public** JWT(`eyJ...`)를 `NEXT_PUBLIC_SUPABASE_ANON_KEY`에 넣습니다. 새 UI의 `sb_publishable_...` key도 public key로 지원합니다. `service_role`/`sb_secret_...`는 이 public 변수에 넣으면 안 됩니다. Vercel의 `NEXT_PUBLIC_*` 변경값은 빌드 시 인라인되므로 저장 후 새 배포가 필요합니다.

---

## 연결 체크리스트

- [x] Supabase 프로젝트 생성
- [x] `.env.local`에 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` 설정
- [x] SQL Editor에서 위 스키마 실행
- [ ] `supabase gen types typescript --project-id <ref>` 로 `src/lib/supabase/types.ts` 재생성 (선택)
- [x] `SupabaseRealtimeAdapter` 구현 완료 (자동 활성화)

---

## 채널 구성

| 채널명 | 목적 | 이벤트 |
|--------|------|--------|
| `sim-events-changes` | events 테이블 INSERT 구독 (중복 방지: session_id 필터) | postgres_changes INSERT |
| `_conn_check` | 연결 상태 확인 전용 (ConnectionStatus 컴포넌트) | subscribe state |
| `agent-state` (예정) | 에이전트 상태 실시간 동기화 | postgres_changes on agents |
| `task-updates` (예정) | 태스크 변경 동기화 | postgres_changes on tasks |
