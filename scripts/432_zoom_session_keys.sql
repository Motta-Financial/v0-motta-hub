-- 432: Zoom — key meetings by SESSION (uuid), part 1 of 2 (additive).
--
-- A Zoom meeting NUMBER is not a meeting. A Personal Meeting Room and every
-- recurring meeting reuse one number for every session held in it (one PMI
-- holds hundreds of unrelated client calls). Only the meeting UUID identifies
-- a single session. Recordings, transcripts and AI summaries are already
-- stored per UUID; zoom_meetings — and everything hanging off it (client
-- links, participants, work-item tags, debriefs, "tag this meeting" tasks) —
-- was one row per NUMBER, so every session of a shared number shared one
-- client link. That link is what filed other clients' meeting notes on the
-- wrong client record (see lib/zoom/meeting-occurrence.ts).
--
-- Design: one zoom_meetings row per session, unique on zoom_uuid. Every child
-- table already references zoom_meetings(id), so they all become per-session
-- with no change to their shape. (The alternative — a session-keyed link
-- table beside a per-number row — would need a uuid column on clients, work
-- items, deals, projects, participants and debriefs, and every reader to
-- filter on it; missing one reader silently brings the bug back.) A scheduled
-- recurring/PMI series keeps its own row under the series uuid, so the
-- calendar still shows upcoming meetings.
--
-- This file is ADDITIVE and safe under the code that is live today:
--   1. unique index on zoom_meetings.zoom_uuid (0 duplicates, 0 nulls today)
--   2. tasks.zoom_meeting_uuid + a unique (assignee_id, zoom_meeting_uuid)
--      index, backfilled from the meeting row each task was made for
--   3. the client-link → re-summarize trigger (336) and the tag → close-todo
--      trigger match on the SESSION, not the number
--   4. zoom_meetings.scheduled_uuid — when a one-off meeting's scheduled row
--      turns out to BE a session that ran under another uuid, the row is
--      re-keyed to the session uuid and keeps the scheduled one here, so
--      Zoom's meeting lists (which keep returning the scheduled uuid) still
--      find it instead of inserting a twin
--   5. occurrence_start on client / work-item tags — a tag put on an
--      upcoming occurrence of a recurring meeting sits on the series row;
--      this records which occurrence it was meant for, so it is copied onto
--      that session's own row when the session runs
--
-- ORDER: apply 432 BEFORE deploying the per-session code (it upserts with
-- onConflict zoom_uuid / assignee_id,zoom_meeting_uuid, which needs these
-- indexes), then apply 433 right AFTER the deploy (433 drops the per-number
-- unique key the old code's upserts depend on).
--
-- Idempotent. Run:
--   psql "$POSTGRES_URL_NON_POOLING" -f scripts/432_zoom_session_keys.sql

begin;

-- ── 1. zoom_meetings: unique per session ─────────────────────────────────
create unique index if not exists zoom_meetings_zoom_uuid_key
  on public.zoom_meetings (zoom_uuid);

alter table public.zoom_meetings
  add column if not exists scheduled_uuid text;
comment on column public.zoom_meetings.scheduled_uuid is
  'The scheduled meeting uuid this session row was adopted from (Zoom lists keep returning it). Look rows up by zoom_uuid OR scheduled_uuid.';
create unique index if not exists zoom_meetings_scheduled_uuid_key
  on public.zoom_meetings (scheduled_uuid) where scheduled_uuid is not null;

-- ── 1b. Which occurrence a tag on a series row was meant for ─────────────
alter table public.zoom_meeting_clients
  add column if not exists occurrence_start timestamptz;
alter table public.zoom_meeting_work_items
  add column if not exists occurrence_start timestamptz;
comment on column public.zoom_meeting_clients.occurrence_start is
  'Start time of the meeting occurrence the tagger was looking at. On a recurring series row this says which session the tag belongs to; it is copied onto that session''s row when the session runs.';
comment on column public.zoom_meeting_work_items.occurrence_start is
  'See zoom_meeting_clients.occurrence_start.';

-- ── 2. tasks: "tag this meeting" todos are per session ───────────────────
alter table public.tasks
  add column if not exists zoom_meeting_uuid text;

comment on column public.tasks.zoom_meeting_uuid is
  'Zoom meeting UUID (one session) the "tag this meeting" todo is for. zoom_meeting_id is the meeting NUMBER, which Personal Meeting Rooms and recurring meetings reuse across sessions.';

-- Today each number has exactly one zoom_meetings row, and that row is the
-- one the todo sweep read when it created the task.
update public.tasks t
set zoom_meeting_uuid = zm.zoom_uuid
from public.zoom_meetings zm
where t.zoom_meeting_id is not null
  and t.zoom_meeting_uuid is null
  and zm.zoom_meeting_id = t.zoom_meeting_id;

-- FULL (non-partial) unique index: PostgREST's onConflict arbiter can only
-- match a complete index (see migration 349). Ordinary tasks have a NULL
-- uuid and never conflict, because NULLs are distinct.
create unique index if not exists tasks_unique_zoom_session_per_assignee
  on public.tasks (assignee_id, zoom_meeting_uuid);

-- ── 3a. Re-queue summaries for the linked SESSION only ───────────────────
-- 336 re-queued every transcript under the meeting NUMBER whenever a client
-- was linked, which re-queued a PMI's whole history against one client.
create or replace function public.requeue_transcript_summary_on_client_link()
returns trigger
language plpgsql
as $$
begin
  if new.contact_id is null then
    return new;
  end if;

  update public.zoom_transcripts zt
  set summary_status = 'pending'
  from public.zoom_meetings zm
  where zm.id = new.zoom_meeting_id
    and zm.zoom_uuid is not null
    and zt.zoom_meeting_uuid = zm.zoom_uuid
    -- skipped_shared_number: the blanket guard from #407, superseded by
    -- per-session links (433 converts those rows; this covers stragglers).
    and zt.summary_status in ('skipped_no_client', 'skipped_shared_number')
    and zt.text_content is not null;

  return new;
end;
$$;

-- ── 3b. Close the "tag this meeting" todo for the tagged SESSION only ────
create or replace function public.fn_zoom_meeting_autoclose_todo()
returns trigger
language plpgsql
as $$
declare
  v_zoom_meeting_id bigint;
  v_zoom_uuid text;
  v_client_count int;
  v_work_item_count int;
begin
  select zm.zoom_meeting_id, zm.zoom_uuid into v_zoom_meeting_id, v_zoom_uuid
  from public.zoom_meetings zm
  where zm.id = NEW.zoom_meeting_id;
  if v_zoom_meeting_id is null then return NEW; end if;

  select count(*) into v_client_count
  from public.zoom_meeting_clients where zoom_meeting_id = NEW.zoom_meeting_id;

  select count(*) into v_work_item_count
  from public.zoom_meeting_work_items where zoom_meeting_id = NEW.zoom_meeting_id;

  if v_client_count > 0 and v_work_item_count > 0 then
    update public.tasks
    set is_completed = true,
        completed_at = coalesce(completed_at, now()),
        status = case when status = 'open' then 'completed' else status end,
        updated_at = now()
    where source_type = 'zoom_meeting'
      and is_completed = false
      and (
        zoom_meeting_uuid = v_zoom_uuid
        -- Legacy task with no session recorded: only close it when the
        -- number has never held another session.
        or (
          zoom_meeting_uuid is null
          and zoom_meeting_id = v_zoom_meeting_id
          and (select count(*) from public.zoom_meetings z
               where z.zoom_meeting_id = v_zoom_meeting_id) = 1
        )
      );
  end if;

  return NEW;
end
$$;

commit;
