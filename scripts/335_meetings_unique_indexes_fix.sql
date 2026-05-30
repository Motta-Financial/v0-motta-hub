-- Migration 335: make the `meetings` unique indexes usable as ON CONFLICT
-- targets.
--
-- Migration 334 created PARTIAL unique indexes (... WHERE col IS NOT NULL).
-- PostgREST / Supabase `.upsert({ onConflict })` cannot infer a partial index
-- as a conflict target, so every Hub Meetings upsert failed with
-- "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification".
--
-- Plain (non-partial) unique indexes work correctly here: Postgres treats
-- NULLs as DISTINCT by default, so many meetings rows can have a NULL
-- calendly_event_id (Zoom-only meetings) or NULL zoom_meeting_id
-- (Calendly-only meetings) without colliding — while still enforcing
-- uniqueness on the non-null values.

drop index if exists public.meetings_calendly_event_id_key;
drop index if exists public.meetings_zoom_meeting_id_key;

create unique index if not exists meetings_calendly_event_id_key
  on public.meetings (calendly_event_id);

create unique index if not exists meetings_zoom_meeting_id_key
  on public.meetings (zoom_meeting_id);
