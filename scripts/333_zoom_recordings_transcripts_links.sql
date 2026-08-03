-- ─────────────────────────────────────────────────────────────────────────
-- 333: Fix Zoom recording/transcript import + linkage
--
-- Root causes this migration addresses:
--   1. zoom_recordings had NO unique constraint, so every
--      upsert(onConflict: "zoom_uuid" | "zoom_meeting_id") silently failed →
--      0 rows ever persisted. We standardize on zoom_uuid (the per-instance
--      meeting UUID, which is correct for recurring meetings) and add the
--      matching unique index PostgREST needs.
--   2. zoom_transcripts rows were stored as bare pointers (status='pending',
--      no text). We add the columns the new ingestion worker needs to store
--      parsed full text + a Blob copy of the VTT.
--
-- Note on media Blob links: a recording row holds MANY files (mp4/m4a/vtt),
-- so per-file Blob URLs are written back into the recording_files jsonb by the
-- worker rather than a single top-level column. Transcripts are 1 VTT per row,
-- so they get a dedicated blob_url column.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Unique key for zoom_recordings on the meeting-instance UUID.
--    Non-partial unique index → usable as an ON CONFLICT target by PostgREST.
--    (NULL zoom_uuid rows remain allowed/distinct, but both writers always
--    set it.)
create unique index if not exists zoom_recordings_zoom_uuid_uidx
  on public.zoom_recordings (zoom_uuid);

-- 2. Transcript ingestion columns (idempotent).
alter table public.zoom_transcripts
  add column if not exists text_content text,          -- plain-text transcript
  add column if not exists blob_url text,              -- Vercel Blob copy of VTT
  add column if not exists blob_pathname text,
  add column if not exists parsed_at timestamptz,      -- when VTT was parsed
  add column if not exists download_attempts integer not null default 0;

-- 3. Allow the richer status values the worker uses. The original CHECK already
--    permits pending/downloading/downloaded/parsed/failed/expired — keep it,
--    the worker maps onto 'downloading' → 'parsed' | 'failed'. No change needed
--    unless the constraint is missing 'parsed'; assert it explicitly.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.zoom_transcripts'::regclass
      and conname = 'zoom_transcripts_status_check'
  ) then
    alter table public.zoom_transcripts
      add constraint zoom_transcripts_status_check
      check (status in ('pending','downloading','downloaded','parsed','failed','expired'));
  end if;
end $$;

-- 4. Backfill transcript → meeting linkage where the meeting now exists.
--    (Some historical transcripts arrived via webhook for meetings that were
--    never synced; those stay unlinked until account-sync imports the meeting.)
update public.zoom_transcripts t
set zoom_meeting_id = m.zoom_meeting_id
from public.zoom_meetings m
where t.zoom_meeting_id is null
  and t.zoom_meeting_uuid is not null
  and m.zoom_uuid = t.zoom_meeting_uuid;

-- 5. Helpful lookup indexes for the worker + UI join.
create index if not exists idx_zoom_recordings_uuid
  on public.zoom_recordings (zoom_uuid);

create index if not exists idx_zoom_transcripts_pending
  on public.zoom_transcripts (status)
  where status in ('pending','downloading','failed');
