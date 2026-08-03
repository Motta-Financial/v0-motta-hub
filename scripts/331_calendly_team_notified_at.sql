-- Migration 331: Add team_notified_at to calendly_events for email dedupe
-- The Calendly webhook now emails all active team members when an
-- invitee.created event fires. To avoid duplicate emails if Calendly
-- retries the webhook or the sync re-processes an event, we track when
-- the email was sent.

ALTER TABLE calendly_events
  ADD COLUMN IF NOT EXISTS team_notified_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN calendly_events.team_notified_at IS
  'Timestamp when the team-wide "new meeting booked" email was sent; NULL = not yet notified. Used to dedupe retries.';
