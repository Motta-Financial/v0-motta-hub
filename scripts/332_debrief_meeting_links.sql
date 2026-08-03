-- 332_debrief_meeting_links.sql
-- Links debriefs to the specific meeting they cover (Calendly or Zoom) and
-- adds dedupe markers so the hourly debrief-reminder cron emails each meeting
-- exactly once. Idempotent.

-- 1. Link columns on debriefs -> meeting tables.
--    A debrief covers at most one Calendly event OR one Zoom meeting.
alter table public.debriefs
  add column if not exists calendly_event_id uuid references public.calendly_events(id) on delete set null,
  add column if not exists zoom_meeting_id uuid references public.zoom_meetings(id) on delete set null;

create index if not exists idx_debriefs_calendly_event_id
  on public.debriefs (calendly_event_id)
  where calendly_event_id is not null;

create index if not exists idx_debriefs_zoom_meeting_id
  on public.debriefs (zoom_meeting_id)
  where zoom_meeting_id is not null;

-- 2. Dedupe marker: when ALFRED has emailed the debrief request for a meeting.
--    NULL = not yet requested. Set once by the cron after a successful send.
alter table public.calendly_events
  add column if not exists debrief_requested_at timestamptz;

alter table public.zoom_meetings
  add column if not exists debrief_requested_at timestamptz;

-- Partial indexes to make the cron's "ended, not yet requested" scan cheap.
create index if not exists idx_calendly_events_debrief_pending
  on public.calendly_events (end_time)
  where debrief_requested_at is null;

-- Zoom has no end_time column; meetings end at start_time + duration (or
-- ended_at once Zoom reports it). Index on start_time for the cron scan.
create index if not exists idx_zoom_meetings_debrief_pending
  on public.zoom_meetings (start_time)
  where debrief_requested_at is null;
