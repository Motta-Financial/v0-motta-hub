-- 357: Recover the AI Companion meeting summaries that the
-- meeting.summary_completed handler dropped.
--
-- ROOT CAUSE (fixed in lib/zoom-webhook-handlers.ts, same commit):
-- Zoom keys this event's object as `meeting_uuid` / `meeting_id`, not the
-- standard `uuid` / `id` used by the recording events. The handler read
-- `obj.uuid`, found nothing, and bailed with "missing_uuid" — so EVERY
-- summary since the feature went live failed (133 events, most recent
-- 2026-07-24). Each payload carries a full recap plus per-person next
-- steps, which is exactly the content debriefs and todo generation want.
--
-- The receiver stored every raw payload, so nothing was lost — this
-- replays them into zoom_meetings.raw_data->'summary', which is where the
-- fixed handler writes. Matching mirrors the handler: numeric meeting_id
-- first, then zoom_uuid. 114 of 133 match a synced meeting; the ~19 that
-- don't are meetings never synced into the Hub (host not connected, or
-- outside the sync window) and are marked 'skipped', matching the
-- handler's own no_matching_meeting_row branch.

WITH latest AS (
  -- One row per meeting: the most recent summary event wins.
  SELECT DISTINCT ON (coalesce(raw_payload->'payload'->'object'->>'meeting_uuid',
                               raw_payload->'payload'->'object'->>'meeting_id'))
         id,
         raw_payload->'payload'->'object' AS obj,
         raw_payload->'payload'->'object'->>'meeting_id'   AS mid,
         raw_payload->'payload'->'object'->>'meeting_uuid' AS muuid,
         received_at
  FROM zoom_webhook_events
  WHERE event_type = 'meeting.summary_completed'
    AND processing_status = 'failed'
  ORDER BY coalesce(raw_payload->'payload'->'object'->>'meeting_uuid',
                    raw_payload->'payload'->'object'->>'meeting_id'),
           received_at DESC
),
resolved AS (
  SELECT l.*, m.id AS meeting_row_id, m.raw_data
  FROM latest l
  JOIN zoom_meetings m
    ON m.zoom_meeting_id::text = l.mid
    OR m.zoom_uuid = l.muuid
),
applied AS (
  UPDATE zoom_meetings m
     SET raw_data = coalesce(m.raw_data, '{}'::jsonb) || jsonb_build_object('summary', r.obj),
         last_event_type = 'meeting.summary_completed',
         last_event_at = r.received_at,
         updated_at = now()
    FROM resolved r
   WHERE m.id = r.meeting_row_id
  RETURNING m.id
)
SELECT (SELECT count(*) FROM applied) AS meetings_updated;

-- Mark the replayed events processed, and the unmatchable ones skipped.
UPDATE zoom_webhook_events e
   SET processing_status = 'succeeded',
       processing_error = NULL,
       processed_at = now()
 WHERE e.event_type = 'meeting.summary_completed'
   AND e.processing_status = 'failed'
   AND EXISTS (
     SELECT 1 FROM zoom_meetings m
      WHERE m.zoom_meeting_id::text = e.raw_payload->'payload'->'object'->>'meeting_id'
         OR m.zoom_uuid = e.raw_payload->'payload'->'object'->>'meeting_uuid'
   );

UPDATE zoom_webhook_events e
   SET processing_status = 'skipped',
       processing_error = 'no_matching_meeting_row (backfill 357)',
       processed_at = now()
 WHERE e.event_type = 'meeting.summary_completed'
   AND e.processing_status = 'failed';
