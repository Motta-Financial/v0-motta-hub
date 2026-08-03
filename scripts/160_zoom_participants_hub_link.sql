-- 160_zoom_participants_hub_link.sql
--
-- Hub-first contact creation from Zoom meetings.
--
-- The Zoom integration historically created Hub links only when a
-- teammate manually tagged a meeting. External attendees who never
-- got tagged effectively didn't exist as Hub contacts.
--
-- This migration adds a single watermark column on `zoom_meetings` so
-- the participant-sync helper can decide which meetings still need a
-- pass against Zoom's `/past_meetings/{uuid}/participants` endpoint
-- and the Hub auto-create flow. Linking continues to flow through
-- the existing `zoom_meeting_clients` table (link_source = 'auto')
-- so the Zoom dashboard's tag UI keeps working unchanged.
--
-- Idempotent: safe to re-run.

ALTER TABLE zoom_meetings
  ADD COLUMN IF NOT EXISTS participants_processed_at TIMESTAMPTZ;

COMMENT ON COLUMN zoom_meetings.participants_processed_at IS
  'Set by the participant-sync helper after it has fetched the participant list and written zoom_meeting_clients rows for every external attendee. NULL = not yet processed.';

CREATE INDEX IF NOT EXISTS idx_zoom_meetings_participants_pending
  ON zoom_meetings(start_time DESC)
  WHERE participants_processed_at IS NULL AND status = 'ended';
