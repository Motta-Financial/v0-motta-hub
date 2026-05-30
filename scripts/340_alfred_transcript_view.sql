-- 340_alfred_transcript_view.sql
--
-- A column-restricted, read-only projection of `zoom_transcripts` for ALFRED.
--
-- WHY: ALFRED's purpose is to ground answers in the firm's own data, and
-- meeting transcripts are some of the richest context we have. But the raw
-- `zoom_transcripts` table also carries sensitive / non-groundable fields:
--   - download_url / download_token  -> short-lived Zoom media credentials
--   - blob_url / blob_pathname        -> direct Vercel Blob locations
--   - vtt_content / segments          -> large raw payloads that blow the
--                                        model's context budget (we already
--                                        keep the parsed plain text)
--
-- The ALFRED data route + queryDatabase tool both `select("*")`, so the only
-- safe way to expose transcripts is through a view that simply never selects
-- those columns. This view is what gets added to the ALFRED allow-list, NOT
-- the base table.
--
-- The view runs with the privileges of its owner and is read by ALFRED via
-- the service-role client (createAdminClient), so no extra GRANTs are needed.
-- It is deliberately NOT exposed to the anon role.

create or replace view public.alfred_meeting_transcripts as
select
  t.id,
  t.zoom_meeting_id,
  t.zoom_meeting_uuid,
  t.team_member_id,
  t.language,
  t.text_content,
  t.duration_seconds,
  t.status,
  t.summary_status,
  t.summary_note_id,
  t.summarized_at,
  t.parsed_at,
  t.synced_at,
  t.created_at
from public.zoom_transcripts t
-- Only surface transcripts that actually have parsed plain text to ground on.
where t.text_content is not null
  and length(btrim(t.text_content)) > 0;

comment on view public.alfred_meeting_transcripts is
  'Column-restricted, read-only view of zoom_transcripts for ALFRED. Excludes download_url/download_token/blob_url/blob_pathname (credentials/locations) and vtt_content/segments (oversized raw payloads). Added to lib/alfred/allowed-tables.ts; never expose the base zoom_transcripts table to ALFRED.';

-- Make sure the anon role can NOT read this view (PII / internal context).
revoke all on public.alfred_meeting_transcripts from anon;
