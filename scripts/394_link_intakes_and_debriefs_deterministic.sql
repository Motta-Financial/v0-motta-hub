-- 394: Link the intakes and debriefs that resolve on an EXACT identifier.
--
-- Scope is deliberately narrow. The audit measured how much of the orphan
-- backlog is actually recoverable without guessing, and the answer is: not
-- much. Both statements below require exact equality AND uniqueness on both
-- sides, so neither can attach one client's record to another.
--
-- INTAKES — 9 of 50 unlinked rows.
--   Measured segmentation of the 50 (mutually exclusive, sums to 50):
--     * 9  — submitter_email equals the primary_email of exactly ONE non-Deleted
--            contact, and NO organization claims that email  -> linked here
--     * 1  — email matches two live contacts (a genuine duplicate-contact pair)
--            -> needs contact dedupe first, left alone
--     * 20 — email present, matches nothing -> genuinely NEW prospects, should
--            create a client record rather than link to one
--     * 20 — no email at all, or business-name only
--   Two hypothesised paths yield ZERO: jotform_intake_submissions.calendly_event_id
--   and lead_id are NULL on all 243 rows (and public.leads is empty), so there is
--   no transitive Calendly link and no lead pin to use.
--   Business-name equality is NOT usable: organizations holds 44 rows in 5
--   exact-name collision groups (SHIN x17, testgrace x10, tekyz x8,
--   Trailways Investments LLC x7, Northwestern Mutual x2), all Karbon-sourced
--   with distinct karbon_organization_key.
--
-- DEBRIEFS — 2 of 354 unlinked rows.
--   Of the 30 unlinked debriefs carrying a karbon_client_key, only 2 hold a
--   GENUINE Karbon key matching exactly one client. The other 28 hold legacy
--   Airtable codes shaped {STATE}_{LAST}_{FIRST}_{NNNN} (e.g.
--   'MA_CAINE_PATRICK_9681') which match nothing in either Karbon key column —
--   debriefs.karbon_client_key is polluted with two identifier namespaces
--   (318 of 590 populated values are Airtable codes, not Karbon keys).
--   The remaining 324 unlinked debriefs carry no structured signal at all:
--   calendly_event_id, zoom_meeting_id, client_group_id, meeting_id, deal_id
--   and organization_name are NULL on all 354.
--   ORGANIZATION WINS is honoured by requiring zero organization matches.
--
-- Idempotent: both statements re-filter on "still unlinked", so a second run
-- updates 0 rows and cannot clobber a human's correction.
--
-- Run: psql "$POSTGRES_URL_NON_POOLING" -f scripts/394_link_intakes_and_debriefs_deterministic.sql

begin;

-- ── Intakes: exact submitter_email -> exactly one live contact ───────────
update public.jotform_intake_submissions t
set contact_id  = m.cid,
    link_method = 'auto_email',   -- matches the existing convention (155 rows)
    linked_at   = now()
from (
  select j.id,
    (select c.id from public.contacts c
      where lower(trim(c.primary_email)) = lower(trim(j.submitter_email))
        and coalesce(c.status, '') <> 'Deleted') as cid
  from public.jotform_intake_submissions j
  where j.contact_id is null
    and j.organization_id is null
    and nullif(trim(j.submitter_email), '') is not null
    and (select count(*) from public.contacts c
         where lower(trim(c.primary_email)) = lower(trim(j.submitter_email))
           and coalesce(c.status, '') <> 'Deleted') = 1
    -- org-wins: refuse if an organization also claims this email
    and (select count(*) from public.organizations o
         where lower(trim(o.primary_email)) = lower(trim(j.submitter_email))) = 0
) m
where t.id = m.id
  and t.contact_id is null
  and t.organization_id is null;

-- ── Debriefs: genuine Karbon key -> exactly one client (ORG WINS) ────────
update public.debriefs d
set contact_id = m.cid
from (
  select x.id,
    (select c.id from public.contacts c
      where c.karbon_contact_key = x.karbon_client_key) as cid
  from public.debriefs x
  where x.contact_id is null
    and x.organization_id is null
    and x.deleted_at is null
    and nullif(trim(x.karbon_client_key), '') is not null
    and (select count(*) from public.contacts c
         where c.karbon_contact_key = x.karbon_client_key) = 1
    and (select count(*) from public.organizations o
         where o.karbon_organization_key = x.karbon_client_key) = 0
) m
where d.id = m.id
  and d.contact_id is null
  and d.organization_id is null;

commit;

-- Verified after running: intakes unlinked 50 -> 41, debriefs unlinked 354 -> 352.
-- Re-run client_profile_summaries (script 393) afterwards so the debrief counts
-- on the affected profiles pick up the two new links.
