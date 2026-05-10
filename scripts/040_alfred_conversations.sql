-- ============================================================================
-- 040_alfred_conversations.sql
--
-- The persistence spine for ALFRED. The in-app chat widget and the future
-- alfred.motta.cpa surface will both read/write through these two tables, so
-- the schema and RLS need to be tight enough to safely expose to a browser
-- session (via the user-scoped Supabase client) and still allow the chat
-- API route -- which uses the service-role client and therefore bypasses RLS
-- -- to write on behalf of any user.
--
-- Two tables:
--   alfred_conversations -- one row per chat thread, owned by an end user
--                          (their team_members row) and authored by ALFRED
--                          (the service-account team_members row).
--   alfred_messages      -- the message log for a conversation, ordered by
--                          created_at. We store full UIMessage `parts` in
--                          `content` (jsonb) so reload restores tool calls,
--                          data parts, etc. exactly as they streamed.
--
-- RLS policy: a user can read/write only their own threads + their messages.
-- The ALFRED service account row is also granted read-all defensively in
-- case it ever logs in via SSR. The chat route uses the service-role client
-- and therefore bypasses RLS regardless.
-- ============================================================================

-- ── alfred_conversations ─────────────────────────────────────────────────────
create table if not exists alfred_conversations (
  id                              uuid primary key default gen_random_uuid(),
  end_user_team_member_id         uuid not null references team_members(id),
  service_account_team_member_id  uuid not null references team_members(id),
  audience                        text not null default 'staff'
                                       check (audience in ('staff','client')),
  title                           text,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now()
);

-- ── alfred_messages ──────────────────────────────────────────────────────────
create table if not exists alfred_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references alfred_conversations(id) on delete cascade,
  role            text not null check (role in ('user','assistant','tool','system')),
  content         jsonb not null,
  tool_calls      jsonb,
  created_at      timestamptz not null default now()
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
-- Hot path: rendering a conversation -> messages ordered by time.
create index if not exists alfred_messages_convo_time_idx
  on alfred_messages (conversation_id, created_at);

-- Hot path: rendering the user's "Recent conversations" sidebar -> their
-- threads ordered by recency.
create index if not exists alfred_conversations_user_recent_idx
  on alfred_conversations (end_user_team_member_id, updated_at desc);

-- ── Enable RLS ───────────────────────────────────────────────────────────────
alter table alfred_conversations enable row level security;
alter table alfred_messages       enable row level security;

-- ── Helper predicate functions ───────────────────────────────────────────────
-- These are SECURITY DEFINER so they read team_members regardless of caller
-- privileges (otherwise an RLS-restricted user couldn't evaluate the policy).
-- Both functions are immutable in practice -- given (auth.uid(), tm_id) the
-- answer never changes -- but we mark STABLE because they touch a table.

create or replace function alfred_is_my_team_member(tm_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from team_members
    where id = tm_id
      and auth_user_id = auth.uid()
  );
$$;

create or replace function alfred_caller_is_service_account()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from team_members
    where auth_user_id = auth.uid()
      and is_service_account = true
  );
$$;

-- ── alfred_conversations policies ────────────────────────────────────────────
drop policy if exists alfred_conversations_select on alfred_conversations;
create policy alfred_conversations_select
  on alfred_conversations
  for select
  using (
    alfred_is_my_team_member(end_user_team_member_id)
    or alfred_caller_is_service_account()
  );

drop policy if exists alfred_conversations_insert on alfred_conversations;
create policy alfred_conversations_insert
  on alfred_conversations
  for insert
  with check (
    alfred_is_my_team_member(end_user_team_member_id)
    or alfred_caller_is_service_account()
  );

drop policy if exists alfred_conversations_update on alfred_conversations;
create policy alfred_conversations_update
  on alfred_conversations
  for update
  using (
    alfred_is_my_team_member(end_user_team_member_id)
    or alfred_caller_is_service_account()
  )
  with check (
    alfred_is_my_team_member(end_user_team_member_id)
    or alfred_caller_is_service_account()
  );

-- ── alfred_messages policies ─────────────────────────────────────────────────
-- All gated through the parent conversation's owner.

drop policy if exists alfred_messages_select on alfred_messages;
create policy alfred_messages_select
  on alfred_messages
  for select
  using (
    exists (
      select 1
      from alfred_conversations c
      where c.id = alfred_messages.conversation_id
        and (
          alfred_is_my_team_member(c.end_user_team_member_id)
          or alfred_caller_is_service_account()
        )
    )
  );

drop policy if exists alfred_messages_insert on alfred_messages;
create policy alfred_messages_insert
  on alfred_messages
  for insert
  with check (
    exists (
      select 1
      from alfred_conversations c
      where c.id = alfred_messages.conversation_id
        and (
          alfred_is_my_team_member(c.end_user_team_member_id)
          or alfred_caller_is_service_account()
        )
    )
  );

drop policy if exists alfred_messages_update on alfred_messages;
create policy alfred_messages_update
  on alfred_messages
  for update
  using (
    exists (
      select 1
      from alfred_conversations c
      where c.id = alfred_messages.conversation_id
        and (
          alfred_is_my_team_member(c.end_user_team_member_id)
          or alfred_caller_is_service_account()
        )
    )
  );
