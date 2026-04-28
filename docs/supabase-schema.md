# Supabase Schema Design

AI Agent Office Simulator — Milestone 3 데이터베이스 설계

---

## 테이블 목록

| 테이블 | 목적 |
|--------|------|
| `agents` | 에이전트 현재 상태 스냅샷 (session별) |
| `tasks` | 태스크 목록 및 상태 추적 |
| `events` | 시뮬레이션 이벤트 로그 (append-only) |
| `agent_traces` | LLM 호출 트레이스 (Milestone 3 이후 사용) |

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

-- 변경 시 자동으로 updated_at 갱신
create trigger agents_updated_at
  before update on public.agents
  for each row execute function moddatetime(updated_at);

-- Realtime 활성화
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
  for each row execute function moddatetime(updated_at);

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
  type        text        not null,   -- task | meeting | chat | system | review
  message     text        not null,
  metadata    jsonb,                  -- 자유 형식 추가 데이터
  timestamp   timestamptz not null default now()
);

create index events_session_id      on public.events (session_id);
create index events_agent_id        on public.events (agent_id);
create index events_timestamp       on public.events (timestamp desc);

-- 이벤트는 read-only broadcast로만 사용
alter publication supabase_realtime add table public.events;
```

---

## 4. `agent_traces`

Claude API 호출 트레이스. Milestone 3에서 AgentOps 연동 전까지는 insert만 수행.

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

## Row Level Security (RLS)

모든 테이블에 RLS 활성화. 최초 단계에서는 anon read 허용.

```sql
-- agents
alter table public.agents  enable row level security;
create policy "anon read" on public.agents  for select using (true);

-- tasks
alter table public.tasks   enable row level security;
create policy "anon read" on public.tasks   for select using (true);

-- events
alter table public.events  enable row level security;
create policy "anon read" on public.events  for select using (true);

-- agent_traces (read-only from client — write via service role only)
alter table public.agent_traces enable row level security;
create policy "anon read" on public.agent_traces for select using (true);
```

---

## 연결 체크리스트

Milestone 3 시작 전:

- [ ] Supabase 프로젝트 생성
- [ ] `.env.local`에 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` 설정
- [ ] SQL Editor에서 위 스키마 실행
- [ ] `supabase gen types typescript --project-id <ref>` 로 `src/lib/supabase/types.ts` 재생성
- [ ] `SupabaseRealtimeAdapter.broadcast()` / `subscribe()` stub 주석 해제
- [ ] `persistEvent()` in `src/lib/realtime/index.ts` 구현

---

## 채널 구성

| 채널명 | 목적 | 이벤트 |
|--------|------|--------|
| `sim-events` | 에이전트 이벤트 브로드캐스트 | BusEventType 전체 |
| `agent-state` | 에이전트 상태 실시간 동기화 | postgres_changes on agents |
| `task-updates` | 태스크 변경 동기화 | postgres_changes on tasks |
