-- 380: Full-fidelity Zoom import.
--
-- Companion to 379's field-coverage pass. Three gaps remained between
-- what the Zoom APIs deliver and what the Hub persists:
--
--   1. PARTICIPANTS — `/past_meetings/{uuid}/participants` rows were
--      consumed transiently (name+email → Hub contact) and then thrown
--      away. New table `zoom_meeting_participants` keeps every row with
--      every field Zoom sends (join/leave, duration, device, status…)
--      plus the resolved Hub contact link.
--
--   2. ZOOM CONTACTS — the Team Chat contacts directory
--      (`/chat/users/me/contacts?type=external|company`) was never
--      imported. New table `zoom_contacts` stores each connection's
--      directory with a link to the matched Hub contact/organization.
--
--   3. AI COMPANION SUMMARIES — `/meetings/{uuid}/meeting_summary`
--      payloads were only written into client notes (and only for
--      client-linked meetings). New table `zoom_meeting_summaries`
--      persists the full structured summary for EVERY meeting.
--
-- Plus typed columns for payload fields that were reaching raw_data but
-- never materialised: recording host/timezone/type/passcode, and the
-- past-meeting rollups (participants_count, total_minutes, …).
--
-- Idempotent: safe to re-run.

-- ────────────────────────────────────────────────────────────────────────
-- 1. zoom_meeting_participants — one row per Zoom participant session
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.zoom_meeting_participants (
  id                    uuid primary key default gen_random_uuid(),

  -- Parent meeting (Hub row + denormalized Zoom identifiers)
  zoom_meeting_id       uuid not null references public.zoom_meetings(id) on delete cascade,
  zoom_meeting_uuid     text,
  zoom_meeting_numeric_id bigint,

  -- Everything /past_meetings/{uuid}/participants delivers
  zoom_participant_id   text,             -- payload `id` (empty for guests)
  zoom_user_id          text,             -- payload `user_id` (in-meeting id)
  participant_user_id   text,             -- payload `participant_user_id`
  name                  text,
  email                 text,             -- payload `user_email`
  join_time             timestamptz,
  leave_time            timestamptz,
  duration              integer,          -- seconds in meeting
  registrant_id         text,
  failover              boolean,
  status                text,             -- 'in_meeting' | 'in_waiting_room'
  internal_user         boolean,          -- true = same Zoom account (teammate)

  -- Hub resolution (matches the zoom_meeting_clients semantics)
  contact_id            uuid references public.contacts(id) on delete set null,
  organization_id       uuid references public.organizations(id) on delete set null,
  match_method          text,             -- 'supabase_email' | 'created_contact' | 'zoom_contact_name' | …

  raw_data              jsonb,            -- full participant payload, verbatim
  synced_at             timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists zoom_meeting_participants_meeting_idx
  on public.zoom_meeting_participants (zoom_meeting_id);

create index if not exists zoom_meeting_participants_email_idx
  on public.zoom_meeting_participants (lower(email))
  where email is not null;

create index if not exists zoom_meeting_participants_contact_idx
  on public.zoom_meeting_participants (contact_id)
  where contact_id is not null;

comment on table public.zoom_meeting_participants is
  'Every participant row Zoom returns for a past meeting (one row per join session). Replaced wholesale per meeting on each participant sync; contact_id/organization_id carry the resolved Hub link.';

alter table public.zoom_meeting_participants enable row level security;

drop policy if exists "Authenticated read zoom_meeting_participants" on public.zoom_meeting_participants;
create policy "Authenticated read zoom_meeting_participants"
  on public.zoom_meeting_participants
  for select
  to authenticated
  using (true);

-- ────────────────────────────────────────────────────────────────────────
-- 2. zoom_contacts — Team Chat contact directory per connection
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.zoom_contacts (
  id                    uuid primary key default gen_random_uuid(),

  -- Which connection's directory this row came from
  zoom_connection_id    uuid references public.zoom_connections(id) on delete cascade,
  owner_team_member_id  uuid references public.team_members(id) on delete set null,

  -- Upsert key: Zoom's contact id when present, else the email.
  zoom_contact_key      text not null,
  contact_type          text not null check (contact_type in ('company','external')),

  -- Everything /chat/users/me/contacts delivers (typed where stable)
  zoom_contact_id       text,
  email                 text,
  first_name            text,
  last_name             text,
  display_name          text,
  pronoun               text,
  phone_numbers         jsonb,
  department            text,
  job_title             text,
  location              text,
  presence_status       text,

  -- Hub resolution
  hub_contact_id        uuid references public.contacts(id) on delete set null,
  hub_organization_id   uuid references public.organizations(id) on delete set null,
  match_method          text,
  linked_at             timestamptz,

  raw_data              jsonb,            -- full contact payload, verbatim
  synced_at             timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (zoom_connection_id, contact_type, zoom_contact_key)
);

create index if not exists zoom_contacts_email_idx
  on public.zoom_contacts (lower(email))
  where email is not null;

create index if not exists zoom_contacts_hub_contact_idx
  on public.zoom_contacts (hub_contact_id)
  where hub_contact_id is not null;

comment on table public.zoom_contacts is
  'Zoom Team Chat contact directory (company + external) pulled per user-OAuth connection via /chat/users/me/contacts. hub_contact_id/hub_organization_id carry the matched Hub record.';

alter table public.zoom_contacts enable row level security;

drop policy if exists "Authenticated read zoom_contacts" on public.zoom_contacts;
create policy "Authenticated read zoom_contacts"
  on public.zoom_contacts
  for select
  to authenticated
  using (true);

-- ────────────────────────────────────────────────────────────────────────
-- 3. zoom_meeting_summaries — AI Companion summaries for ALL meetings
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.zoom_meeting_summaries (
  id                        uuid primary key default gen_random_uuid(),

  zoom_meeting_id           uuid references public.zoom_meetings(id) on delete cascade,
  zoom_meeting_uuid         text not null unique,
  zoom_meeting_numeric_id   bigint,

  summary_title             text,
  summary_overview          text,
  summary_details           jsonb,        -- [{label, summary}]
  next_steps                jsonb,        -- [string]
  summary_start_time        timestamptz,
  summary_end_time          timestamptz,
  summary_created_time      timestamptz,
  summary_last_modified_time timestamptz,

  raw_data                  jsonb,        -- full summary payload, verbatim
  synced_at                 timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index if not exists zoom_meeting_summaries_numeric_idx
  on public.zoom_meeting_summaries (zoom_meeting_numeric_id)
  where zoom_meeting_numeric_id is not null;

comment on table public.zoom_meeting_summaries is
  'Zoom AI Companion meeting summaries (/meetings/{uuid}/meeting_summary), persisted for every meeting that has one — independent of the client-note fallback path.';

alter table public.zoom_meeting_summaries enable row level security;

drop policy if exists "Authenticated read zoom_meeting_summaries" on public.zoom_meeting_summaries;
create policy "Authenticated read zoom_meeting_summaries"
  on public.zoom_meeting_summaries
  for select
  to authenticated
  using (true);

-- ────────────────────────────────────────────────────────────────────────
-- 4. zoom_recordings — materialise payload fields the mappers dropped
--    (verified present in stored raw_data: type, timezone, host_id,
--    account_id, recording_play_passcode)
-- ────────────────────────────────────────────────────────────────────────
alter table public.zoom_recordings
  add column if not exists zoom_host_id            text,
  add column if not exists host_email              text,
  add column if not exists meeting_type            integer,
  add column if not exists timezone                text,
  add column if not exists zoom_account_id         text,
  add column if not exists recording_play_passcode text;

update public.zoom_recordings set
  zoom_host_id            = coalesce(zoom_host_id, raw_data->>'host_id'),
  meeting_type            = coalesce(meeting_type,
                             case when raw_data->>'type' ~ '^\d+$'
                                  then (raw_data->>'type')::integer end),
  timezone                = coalesce(timezone, nullif(raw_data->>'timezone','')),
  zoom_account_id         = coalesce(zoom_account_id, raw_data->>'account_id'),
  recording_play_passcode = coalesce(recording_play_passcode, raw_data->>'recording_play_passcode')
where raw_data is not null;

comment on column public.zoom_recordings.recording_play_passcode is
  'Zoom: recording_play_passcode — passcode required by the share_url player.';

-- ────────────────────────────────────────────────────────────────────────
-- 5. zoom_meetings — past-meeting rollups from GET /past_meetings/{uuid}
-- ────────────────────────────────────────────────────────────────────────
alter table public.zoom_meetings
  add column if not exists participants_count     integer,
  add column if not exists total_minutes          integer,
  add column if not exists host_name              text,
  add column if not exists dept                   text,
  add column if not exists meeting_source         text,
  add column if not exists past_details_synced_at timestamptz,
  add column if not exists summary_checked_at     timestamptz;

comment on column public.zoom_meetings.summary_checked_at is
  'Watermark for the AI-summary REST sweep: set after checking /meetings/{uuid}/meeting_summary once (found or not). Late-arriving summaries still land via the meeting.summary_completed webhook.';

comment on column public.zoom_meetings.participants_count is
  'Zoom: participants_count from GET /past_meetings/{uuid}.';
comment on column public.zoom_meetings.total_minutes is
  'Zoom: total_minutes (sum of all participant minutes) from GET /past_meetings/{uuid}.';
comment on column public.zoom_meetings.meeting_source is
  'Zoom: source (e.g. "Zoom", "Outlook plugin") from GET /past_meetings/{uuid}.';
