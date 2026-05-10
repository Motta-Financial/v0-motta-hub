-- Zoom webhook receiver tables.
--
-- Mirrors the audit-log + content-table split used by the Calendly,
-- Karbon, Jotform, and Ignition integrations:
--
--   * `zoom_webhook_events`  — every inbound POST is logged here BEFORE
--     processing so a failed handler can be replayed without losing the
--     payload. Signature validity, processing status, and any error
--     message are stored alongside the raw body.
--
--   * `zoom_transcripts`     — content table for VTT transcripts that
--     arrive via the `recording.transcript_completed` event. The raw
--     VTT is downloaded and persisted so debrief notes and ALFRED
--     search can use it without a per-request round-trip to Zoom.
--
-- Idempotent: every CREATE uses `IF NOT EXISTS` so re-running this on
-- a half-applied database is safe.

-- ─────────────────────────────────────────────────────────────────────
-- 1. zoom_webhook_events — append-only audit log
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.zoom_webhook_events (
  id                  uuid primary key default gen_random_uuid(),

  -- Zoom event metadata
  event_type          text not null,
  event_ts            timestamptz,                 -- from payload.event_ts (ms epoch)
  zoom_account_id     text,
  zoom_user_id        text,
  zoom_meeting_id     bigint,                      -- numeric meeting id when present
  zoom_meeting_uuid   text,                        -- meeting uuid when present

  -- Raw inbound data
  raw_payload         jsonb not null,
  request_headers     jsonb,

  -- Verification + processing
  signature_valid     boolean,
  signature_error     text,
  processing_status   text not null default 'pending'
                      check (processing_status in ('pending','processing','succeeded','failed','skipped')),
  processing_error    text,
  retry_count         integer not null default 0,

  -- Timing
  received_at         timestamptz not null default now(),
  processed_at        timestamptz
);

create index if not exists zoom_webhook_events_event_type_idx
  on public.zoom_webhook_events (event_type, received_at desc);

create index if not exists zoom_webhook_events_meeting_id_idx
  on public.zoom_webhook_events (zoom_meeting_id)
  where zoom_meeting_id is not null;

create index if not exists zoom_webhook_events_meeting_uuid_idx
  on public.zoom_webhook_events (zoom_meeting_uuid)
  where zoom_meeting_uuid is not null;

-- For the eventual replay worker: pull pending and failed rows in
-- arrival order without a full table scan.
create index if not exists zoom_webhook_events_pending_idx
  on public.zoom_webhook_events (processing_status, received_at)
  where processing_status in ('pending','failed');

alter table public.zoom_webhook_events enable row level security;

-- Read-only by default for authenticated users; service role bypasses
-- RLS so the webhook receiver can write without a session cookie.
drop policy if exists "Authenticated read zoom_webhook_events" on public.zoom_webhook_events;
create policy "Authenticated read zoom_webhook_events"
  on public.zoom_webhook_events
  for select
  to authenticated
  using (true);

-- ─────────────────────────────────────────────────────────────────────
-- 2. zoom_transcripts — VTT content for completed meeting recordings
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.zoom_transcripts (
  id                    uuid primary key default gen_random_uuid(),

  -- Foreign keys (nullable so we can store a transcript even if the
  -- recording row hasn't synced yet — the handler back-fills these
  -- once recording.completed lands)
  zoom_recording_id     uuid references public.zoom_recordings(id) on delete cascade,
  zoom_connection_id    uuid references public.zoom_connections(id) on delete set null,
  team_member_id        uuid references public.team_members(id) on delete set null,

  -- Zoom identifiers (denormalized so transcripts can be joined to
  -- meetings without going through `zoom_recordings`)
  zoom_meeting_id       bigint,
  zoom_meeting_uuid     text,
  recording_file_id     text,             -- payload.recording_files[i].id
  file_type             text,             -- 'TRANSCRIPT' (vtt) or 'CC' (closed caption)
  recording_type        text,             -- 'audio_transcript' | 'cc' | etc.

  -- Content
  language              text default 'en-US',
  download_url          text,             -- short-lived Zoom signed URL from payload
  download_token        text,             -- payload.download_token (used when fetching VTT)
  vtt_content           text,             -- raw VTT body (downloaded by handler)
  segments              jsonb,            -- parsed cues: [{start,end,speaker,text}]
  duration_seconds      integer,
  file_size             bigint,

  -- Lifecycle
  status                text not null default 'pending'
                        check (status in ('pending','downloading','downloaded','parsed','failed','expired')),
  error                 text,
  synced_at             timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- A given meeting may have separate TRANSCRIPT and CC files — key
  -- on the recording_file_id to keep them distinct.
  unique (zoom_meeting_uuid, recording_file_id)
);

create index if not exists zoom_transcripts_meeting_id_idx
  on public.zoom_transcripts (zoom_meeting_id);

create index if not exists zoom_transcripts_meeting_uuid_idx
  on public.zoom_transcripts (zoom_meeting_uuid);

create index if not exists zoom_transcripts_team_member_idx
  on public.zoom_transcripts (team_member_id);

create index if not exists zoom_transcripts_recording_idx
  on public.zoom_transcripts (zoom_recording_id);

create index if not exists zoom_transcripts_status_idx
  on public.zoom_transcripts (status, created_at)
  where status in ('pending','downloading','failed');

alter table public.zoom_transcripts enable row level security;

drop policy if exists "Authenticated read zoom_transcripts" on public.zoom_transcripts;
create policy "Authenticated read zoom_transcripts"
  on public.zoom_transcripts
  for select
  to authenticated
  using (true);

drop policy if exists "Authenticated manage zoom_transcripts" on public.zoom_transcripts;
create policy "Authenticated manage zoom_transcripts"
  on public.zoom_transcripts
  for all
  to authenticated
  using (true)
  with check (true);

-- updated_at trigger
create or replace function public.set_zoom_transcripts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_zoom_transcripts_updated_at on public.zoom_transcripts;
create trigger trg_zoom_transcripts_updated_at
  before update on public.zoom_transcripts
  for each row execute function public.set_zoom_transcripts_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- 3. Liveness columns on zoom_meetings
-- ─────────────────────────────────────────────────────────────────────
-- meeting.started/ended events stamp these so the dashboard can show
-- "live now" without a poll round-trip.
alter table public.zoom_meetings
  add column if not exists last_event_type text,
  add column if not exists last_event_at   timestamptz,
  add column if not exists started_at      timestamptz,
  add column if not exists ended_at        timestamptz;

create index if not exists zoom_meetings_last_event_idx
  on public.zoom_meetings (last_event_at desc)
  where last_event_at is not null;
