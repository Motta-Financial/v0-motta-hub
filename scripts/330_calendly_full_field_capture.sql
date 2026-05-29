-- 330_calendly_full_field_capture.sql
--
-- Capture every meaningful field Calendly sends on a booking into queryable
-- columns. Previously the webhook + sync stored the full payload in
-- `raw_data` (JSONB) but only promoted a subset of fields to real columns,
-- so things like the invitee's phone number, reschedule lineage, payment,
-- and no-show status were only reachable by digging through raw_data.
--
-- This migration is additive and idempotent: every column is added with
-- IF NOT EXISTS, so re-running is a no-op and no existing data is touched.
-- A follow-up code change backfills these columns going forward (webhook +
-- polling sync); historical rows can be backfilled from `raw_data` later if
-- desired.
--
-- Reference: https://developer.calendly.com/api-docs (Scheduled Event,
-- Invitee resources)

-- ── Scheduled-event fields ────────────────────────────────────────────────
-- `rescheduled` + `rescheduled_from_uuid` already exist on the table but the
-- webhook never set them (sync only set `rescheduled`). The columns below are
-- net-new event metadata Calendly returns on every scheduled_event.
alter table public.calendly_events
  add column if not exists meeting_notes_plain   text,
  add column if not exists meeting_notes_html    text,
  add column if not exists calendar_kind         text,      -- google / outlook / etc
  add column if not exists calendar_external_id  text,       -- id in the external calendar
  add column if not exists invitees_counter_total  integer,
  add column if not exists invitees_counter_active integer,
  add column if not exists invitees_counter_limit  integer,
  add column if not exists event_guests          jsonb,      -- additional guests on the event
  add column if not exists event_memberships     jsonb;      -- hosts (user, email, name, buffers)

-- ── Invitee fields ────────────────────────────────────────────────────────
-- The invitee is the richest part of a booking. Calendly exposes a number of
-- structured fields we were dropping. `text_reminder_number` is the booking's
-- SMS-reminder phone — the most reliable phone signal Calendly gives us, more
-- dependable than scraping it out of the Q&A.
alter table public.calendly_invitees
  add column if not exists first_name                 text,
  add column if not exists last_name                  text,
  add column if not exists text_reminder_number       text,   -- SMS reminder phone
  add column if not exists rescheduled                boolean,
  add column if not exists old_invitee_uri            text,   -- prior invitee when rescheduled
  add column if not exists new_invitee_uri            text,   -- replacement invitee when rescheduled
  add column if not exists scheduling_method          text,   -- e.g. instant_book
  add column if not exists invitee_scheduled_by_uri   text,   -- who scheduled on the invitee's behalf
  add column if not exists routing_form_submission_uri text,  -- originating routing-form submission
  add column if not exists canceler_name              text,   -- name of whoever canceled
  add column if not exists payment                    jsonb,  -- collected payment details
  add column if not exists no_show                    boolean,-- convenience flag derived from no_show object
  add column if not exists no_show_uri                text,   -- the no_show object uri (for un-marking)
  add column if not exists reconfirmation             jsonb,  -- reconfirmation request state
  add column if not exists tracking                   jsonb;  -- full UTM + salesforce_uuid blob

-- Phone lookups (matching invitees → contacts) benefit from an index on the
-- new dedicated phone column. Partial index keeps it small — most historical
-- rows are NULL until backfilled.
create index if not exists calendly_invitees_text_reminder_number_idx
  on public.calendly_invitees (text_reminder_number)
  where text_reminder_number is not null;
