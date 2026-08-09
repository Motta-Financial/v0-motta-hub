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
-- PART 2 — Zoom (80 rows after the plausibility gate below).
--   zoom_meetings.calendly_event_id is populated on 124 meetings — a native
--   bridge to the Calendly invitee, and therefore to that invitee's contact.
--   Verified before writing:
--     * 81 candidate pairs over 81 DISTINCT meetings (1:1, no fan-out)
--     * 81/81 email-corroborated between invitee and contact
--     * 0 contradict an existing zoom_meeting_clients link
--   link_source='calendly_bridge' is already an allowed value in
--   zoom_meeting_clients_link_source_check, i.e. the schema anticipated
--   exactly this path.
--
--   PLAUSIBILITY GATE — added after adversarial review, which found the
--   original version's weakness: it verified the CONTACT side (invitee email
--   equality) but never checked that the Zoom meeting and the Calendly event
--   are the same meeting. zoom_meetings.calendly_event_id is itself the output
--   of a heuristic bridging job, and it mis-fires badly on reused static rooms:
--   'Dat Le's Personal Meeting Room' was bridged to a booking 295.9 days away,
--   attaching an unrelated contact. A personal meeting room is reused for every
--   call, so it is the worst possible bridge candidate.
--   Measured across the 81: 69 clean, 12 implausible (11 over 5 minutes apart,
--   2 cancelled invitees, 2 cancelled events, 1 static room). Of those 12, 11
--   have the Zoom TOPIC independently naming the contact's surname — those are
--   ordinary rescheduled bookings where the attribution is still right, so they
--   are kept but stamped needs_review with confidence 0.60. Exactly 1 was both
--   implausible AND uncorroborated (the static room); it is excluded here.
--   Rows are NOT written at confidence 1.00 / needs_review false unless they
--   pass the gate — stamping a doubtful link as certain hides it from the only
--   surface a reviewer would look at.
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
with candidate as (
  select distinct
    zm.id as zoom_meeting_id,
    ci.contact_id,
    abs(extract(epoch from (zm.start_time - ce.start_time))) / 60.0 as gap_min,
    -- Does the Zoom topic independently name the contact? That is the evidence
    -- that survives a loose bridge: a rescheduled booking still belongs to the
    -- person the meeting is titled after.
    (c.last_name is not null
       and zm.topic ~* ('\m' || regexp_replace(c.last_name, '([^a-zA-Z0-9])', '\\\1', 'g') || '\M')
    ) as topic_names_contact,
    (zm.topic ~* 'personal meeting room' or zm.topic ~* 'my meeting') as is_static_room,
    (coalesce(ci.status, '') ~* 'cancel' or ci.canceled_at is not null
       or coalesce(ce.status, '') ~* 'cancel') as cancelled
  from public.zoom_meetings zm
  join public.calendly_invitees ci on ci.calendly_event_id = zm.calendly_event_id
  join public.calendly_events ce on ce.id = zm.calendly_event_id
  join public.contacts c on c.id = ci.contact_id
  where zm.calendly_event_id is not null
    and ci.contact_id is not null
    -- contact side: exact email agreement with the invitee
    and (
      lower(trim(c.primary_email))   = lower(trim(ci.email)) or
      lower(trim(c.secondary_email)) = lower(trim(ci.email))
    )
    and not exists (
      select 1 from public.zoom_meeting_clients zc
      where zc.zoom_meeting_id = zm.id and zc.contact_id = ci.contact_id
    )
),
gated as (
  select *,
    (gap_min > 5 or cancelled or is_static_room) as doubtful
  from candidate
  -- Drop only what is BOTH doubtful and uncorroborated by the topic.
  where not ((gap_min > 5 or cancelled or is_static_room) and not topic_names_contact)
)
insert into public.zoom_meeting_clients
  (zoom_meeting_id, contact_id, link_source, match_method, confidence, needs_review, alfred_reason)
select
  zoom_meeting_id,
  contact_id,
  'calendly_bridge',      -- allowed value, purpose-built for this path
  'calendly_event_bridge',
  case when doubtful then 0.60 else 1.0 end,
  doubtful,
  case when doubtful then
    'calendly bridge: booking rescheduled or cancelled (' || round(gap_min)
      || ' min from Zoom start); contact corroborated by meeting topic'
  end
from gated
on conflict do nothing;

commit;

-- Post-run verification (expect calendly 53 -> 205, zoom 139 -> 220):
--   select count(*) from calendly_event_clients;
--   select count(*) from zoom_meeting_clients;
