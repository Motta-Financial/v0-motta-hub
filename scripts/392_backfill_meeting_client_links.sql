-- 392: Backfill meeting→client links that already exist one join away.
--
-- Both backfills mirror a link the database ALREADY holds; neither invents a
-- new identity claim, and every row was independently corroborated by exact
-- normalised-email equality between the invitee and the contact it points at.
--
-- PART 1 — Calendly (152 rows).
--   calendly_invitees carries contact_id on 205 of 232 rows, but
--   calendly_event_clients held only 53 rows, so 152 events had a known
--   invitee contact and no event→client link at all. Verified before writing:
--     * 152 candidates over 152 DISTINCT events (strictly 1:1, no fan-out)
--     * 152/152 corroborated by lower(trim(email)) equality against the linked
--       contact's primary_email or secondary_email — 0 uncorroborated, 0 null
--     * 0 candidates collide with an existing row
--   Join key was verified three ways: calendly_event_clients.calendly_event_id
--   and calendly_invitees.calendly_event_id are BOTH FKs to calendly_events(id)
--   (uuid) — not the Calendly uuid/uri string.
--   Contact-only by design: CHECK one_client_target forbids setting
--   organization_id alongside contact_id, and all 53 pre-existing rows are
--   contact-only, so this follows the established pattern.
--
-- PART 2 — Zoom (81 rows).
--   zoom_meetings.calendly_event_id is populated on 124 meetings — a native
--   bridge to the Calendly invitee, and therefore to that invitee's contact.
--   Verified before writing:
--     * 81 candidate pairs over 81 DISTINCT meetings (1:1, no fan-out)
--     * 81/81 email-corroborated
--     * 0 contradict an existing zoom_meeting_clients link
--     * 77 of the affected meetings have no client link at all today
--   link_source='calendly_bridge' is already an allowed value in
--   zoom_meeting_clients_link_source_check, i.e. the schema anticipated
--   exactly this path.
--
-- NOT ADDRESSED HERE (deliberately): Zoom's real problem is sync coverage, not
-- matching — 355 of 403 past meetings have zero participants synced and 380
-- have past_details_synced_at IS NULL. No SQL can fix that; the past-meeting
-- participant sync needs to be re-run. Participant-based matching is already
-- exhausted (of 194 participants, 138 are Motta staff, 51 have no email, and
-- all 5 remaining external participants are already linked).
--
-- Idempotent: NOT EXISTS guards plus the partial unique indexes
-- (calendly_event_clients_unique_contact, zoom_meeting_clients_unique_contact)
-- make re-runs no-ops. INSERT-only — no existing row is ever modified, so a
-- human's manual correction cannot be clobbered.
--
-- Run: psql "$POSTGRES_URL_NON_POOLING" -f scripts/392_backfill_meeting_client_links.sql

begin;

-- ── Part 1: Calendly invitee contact → calendly_event_clients ───────────
insert into public.calendly_event_clients
  (calendly_event_id, contact_id, link_source, match_method, confidence, needs_review)
select
  i.calendly_event_id,
  i.contact_id,
  'auto',                 -- allowed: 'auto' | 'manual' | 'alfred'
  'invitee_contact',      -- provenance: mirrored from calendly_invitees.contact_id
  1.0,
  false
from public.calendly_invitees i
where i.contact_id is not null
  and i.calendly_event_id is not null
  -- Only mirror where the invitee email exactly matches the contact it points
  -- at. This is what makes the row deterministic rather than inherited trust.
  and exists (
    select 1 from public.contacts c
    where c.id = i.contact_id
      and (
        lower(trim(c.primary_email))   = lower(trim(i.email)) or
        lower(trim(c.secondary_email)) = lower(trim(i.email))
      )
  )
  and not exists (
    select 1 from public.calendly_event_clients ec
    where ec.calendly_event_id = i.calendly_event_id
      and ec.contact_id = i.contact_id
  )
on conflict do nothing;

-- ── Part 2: zoom_meetings.calendly_event_id bridge → zoom_meeting_clients ─
insert into public.zoom_meeting_clients
  (zoom_meeting_id, contact_id, link_source, match_method, confidence, needs_review)
select distinct
  zm.id,
  ci.contact_id,
  'calendly_bridge',      -- allowed value, purpose-built for this path
  'calendly_event_bridge',
  1.0,
  false
from public.zoom_meetings zm
join public.calendly_invitees ci
  on ci.calendly_event_id = zm.calendly_event_id
where zm.calendly_event_id is not null
  and ci.contact_id is not null
  and exists (
    select 1 from public.contacts c
    where c.id = ci.contact_id
      and (
        lower(trim(c.primary_email))   = lower(trim(ci.email)) or
        lower(trim(c.secondary_email)) = lower(trim(ci.email))
      )
  )
  and not exists (
    select 1 from public.zoom_meeting_clients zc
    where zc.zoom_meeting_id = zm.id
      and zc.contact_id = ci.contact_id
  )
on conflict do nothing;

commit;

-- Post-run verification (expect calendly 53 -> 205, zoom 139 -> 220):
--   select count(*) from calendly_event_clients;
--   select count(*) from zoom_meeting_clients;
