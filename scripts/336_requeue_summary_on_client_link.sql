-- 336_requeue_summary_on_client_link.sql
--
-- Make the "no client linked yet" transcript-summary state RECOVERABLE.
--
-- Context: account-wide Zoom import (S2S, Option A) brings in transcripts for
-- meetings that have not been client-tagged yet. The summarizer marks those
-- 'skipped_no_client' instead of plain 'skipped'. When the linkage layers
-- (participant sweep / Calendly bridge / ALFRED triage) later insert a
-- zoom_meeting_clients row, this trigger flips the matching transcript(s)
-- back to 'pending' so the next meeting-summary-ingest cron run summarizes it.
--
-- Join chain:
--   zoom_meeting_clients.zoom_meeting_id (uuid) -> zoom_meetings.id
--   zoom_meetings.zoom_meeting_id (bigint)      -> zoom_transcripts.zoom_meeting_id

-- 1) One-time backfill: reclassify rows that were skipped purely because no
--    client was linked (they have text + a real zoom meeting, but no client).
--    Leaves genuine 'skipped' rows (empty text / no meeting) untouched.
update public.zoom_transcripts zt
set summary_status = 'skipped_no_client'
where zt.summary_status = 'skipped'
  and zt.text_content is not null
  and exists (
    select 1 from public.zoom_meetings zm
    where zm.zoom_meeting_id = zt.zoom_meeting_id
  )
  and not exists (
    select 1
    from public.zoom_meetings zm
    join public.zoom_meeting_clients zmc on zmc.zoom_meeting_id = zm.id
    where zm.zoom_meeting_id = zt.zoom_meeting_id
      and zmc.contact_id is not null
  );

-- 2) Trigger function: re-queue summaries when a client link appears.
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
    and zt.zoom_meeting_id = zm.zoom_meeting_id
    and zt.summary_status = 'skipped_no_client'
    and zt.text_content is not null;

  return new;
end;
$$;

-- 3) Fire after a client link is inserted (the primary path the linkage
--    layers use). Drop-if-exists keeps the migration idempotent.
drop trigger if exists trg_requeue_transcript_summary on public.zoom_meeting_clients;
create trigger trg_requeue_transcript_summary
after insert on public.zoom_meeting_clients
for each row
execute function public.requeue_transcript_summary_on_client_link();
