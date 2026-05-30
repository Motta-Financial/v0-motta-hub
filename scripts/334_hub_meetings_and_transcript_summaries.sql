-- Migration 334: Hub Meetings dashboard + ALFRED transcript summaries
--
-- Two related features:
--   1. Transcript -> client-note summarization: status columns on
--      zoom_transcripts so a cron can find un-summarized transcripts, and a
--      link back to the notes row ALFRED creates.
--   2. Hub Meetings dashboard: partial unique indexes on `meetings` so the
--      Calendly/Zoom sync upserts actually land (they were silently failing
--      because onConflict targeted non-unique columns), plus a
--      hub_meetings_enriched view that joins every linkable surface
--      (Calendly, Zoom, recording/transcript, Debrief, ALFRED summary,
--      Prospect/Intake) onto one Hub Meeting ID.

-- ---------------------------------------------------------------------------
-- 1. Transcript summarization state
-- ---------------------------------------------------------------------------
alter table public.zoom_transcripts
  add column if not exists summary_status text not null default 'pending',
  add column if not exists summary_note_id uuid references public.notes(id) on delete set null,
  add column if not exists summarized_at timestamptz,
  add column if not exists summary_attempts integer not null default 0;

-- Guard the allowed status values without a hard CHECK (so future statuses
-- don't require a migration to add).
comment on column public.zoom_transcripts.summary_status is
  'pending | processing | done | skipped | failed — drives the meeting-summary-ingest cron';

-- Only transcripts that actually have text are eligible for summarization.
create index if not exists idx_zoom_transcripts_summary_pending
  on public.zoom_transcripts (summary_status)
  where summary_status = 'pending' and text_content is not null;

-- ---------------------------------------------------------------------------
-- 2a. Make the `meetings` upserts work (partial unique indexes)
--     The Calendly sync already upserts onConflict 'calendly_event_id' but no
--     unique constraint existed, so every upsert silently failed -> 0 rows.
-- ---------------------------------------------------------------------------
create unique index if not exists meetings_calendly_event_id_key
  on public.meetings (calendly_event_id)
  where calendly_event_id is not null;

create unique index if not exists meetings_zoom_meeting_id_key
  on public.meetings (zoom_meeting_id)
  where zoom_meeting_id is not null;

-- ---------------------------------------------------------------------------
-- 2b. hub_meetings_enriched — one row per Hub Meeting ID with every link
-- ---------------------------------------------------------------------------
create or replace view public.hub_meetings_enriched as
select
  m.id                          as meeting_id,
  m.title,
  m.meeting_type,
  m.status,
  m.scheduled_start,
  m.scheduled_end,
  m.location_type,
  m.video_link,
  m.created_at,
  m.updated_at,

  -- client / host
  m.contact_id,
  c.full_name                   as client_name,
  c.is_prospect                 as client_is_prospect,
  m.organization_id,
  o.name                        as organization_name,
  m.host_id,
  tm.full_name                  as host_name,

  -- Calendly link (m.calendly_event_id stores the internal calendly_events.id)
  ce.id                         as calendly_event_pk,
  ce.calendly_uuid,
  ce.name                       as calendly_name,
  ce.start_time                 as calendly_start_time,
  (ce.id is not null)           as has_calendly,

  -- Zoom link (m.zoom_meeting_id stores the internal zoom_meetings.id)
  zm.id                         as zoom_meeting_pk,
  zm.zoom_meeting_id            as zoom_numeric_id,
  zm.topic                      as zoom_topic,
  (zm.id is not null)           as has_zoom,

  -- recording + transcript (via the numeric zoom meeting id)
  (zr.id is not null)           as has_recording,
  zt.id                         as transcript_id,
  (zt.text_content is not null) as has_transcript,
  zt.summary_status,
  zt.summary_note_id,

  -- Debrief (debriefs may point at the internal calendly/zoom uuid)
  d.id                          as debrief_id,
  d.status                      as debrief_status,
  (d.id is not null)            as has_debrief,

  -- Prospect / Intake — shared contact, no FK on meetings
  ps.id                         as prospect_submission_id,
  ps.lead_status                as prospect_lead_status,
  (ps.id is not null)           as has_prospect

from public.meetings m
left join public.contacts c       on c.id = m.contact_id
left join public.organizations o  on o.id = m.organization_id
left join public.team_members tm  on tm.id = m.host_id
left join public.calendly_events ce on ce.id::text = m.calendly_event_id
left join public.zoom_meetings zm   on zm.id::text = m.zoom_meeting_id
left join lateral (
  select zr.id from public.zoom_recordings zr
  where zr.zoom_meeting_id = zm.zoom_meeting_id
  order by zr.created_at desc limit 1
) zr on true
left join lateral (
  select zt.id, zt.text_content, zt.summary_status, zt.summary_note_id
  from public.zoom_transcripts zt
  where zt.zoom_meeting_id = zm.zoom_meeting_id
  order by (zt.text_content is not null) desc, zt.created_at desc
  limit 1
) zt on true
left join lateral (
  select d.id, d.status from public.debriefs d
  where d.meeting_id = m.id
     or d.calendly_event_id = ce.id
     or d.zoom_meeting_id = zm.id
  order by d.created_at desc limit 1
) d on true
left join lateral (
  select ps.id, ps.lead_status from public.prospect_submissions ps
  where ps.contact_id = m.contact_id and m.contact_id is not null
  order by ps.created_at desc limit 1
) ps on true;

comment on view public.hub_meetings_enriched is
  'One row per Hub Meeting ID joining client, host, Calendly, Zoom, recording/transcript, Debrief, ALFRED summary, and Prospect/Intake. Read-only surface for the /meetings/hub dashboard.';
