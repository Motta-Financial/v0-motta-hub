-- 437: Intake → client links that silently never landed.
--
-- ═══ WHAT WENT WRONG ═════════════════════════════════════════════════
--
-- When a new intake arrives and no existing client matches it, the ingest
-- pipeline (lib/jotform/ingest.ts) creates the Hub contact, pushes it to
-- Karbon, and then writes the link back onto the intake row together with
-- HOW the link was made:
--
--     auto_karbon_created   a brand-new Karbon contact was minted
--     auto_karbon_match     an existing Karbon contact was found
--     auto_hub_created      Karbon was unavailable; Hub contact only
--
-- None of those three values is on the CHECK constraint from migration 047
-- (auto_email | auto_business_name | auto_name | manual), so Postgres
-- rejected the whole UPDATE — contact_id included — and the code never read
-- the error. The contact existed in the Hub and in Karbon; the intake row
-- still said "not linked", and a teammate had to link it by hand from the
-- Intake workstream.
--
-- (prospect_submissions already allows the two Karbon values — see 051 —
-- which is why Hub-entered prospects never had this problem.)
--
-- The application now reads that error and falls back to a value the old
-- constraint accepts, so new intakes link correctly with or without this
-- migration. This file does the two things code cannot:
--
--   1. Widens the constraint so the precise provenance can be recorded.
--   2. Links the intakes that are already sitting unlinked beside their own
--      Hub contact.
--
-- ═══ THE BACKFILL ════════════════════════════════════════════════════
--
-- Same rule, and the same guard rails, as migration 394: an intake is
-- linked only when its submitter_email equals the primary_email of EXACTLY
-- ONE non-deleted contact and NO organization claims that email. Measured
-- against production on 2026-11-25, of 69 unlinked intakes:
--
--     31  resolve to exactly one contact            -> linked here
--      1  matches two live contacts (a duplicate pair)  -> left alone
--     17  have an email that matches nothing        -> left alone
--     20  have no email at all                      -> left alone
--
-- link_method is set to 'auto_email' because that is literally what this
-- statement does (the original provenance was never stored). The automatic
-- matcher is free to refine an auto_* link later; it never touches a row a
-- teammate linked by hand (link_method = 'manual'), and neither does this.
--
-- Idempotent: the constraint swap is drop-if-exists + add, and the UPDATE
-- re-filters on "still unlinked", so a second run changes 0 rows.
--
-- Run: psql "$POSTGRES_URL_NON_POOLING" -f scripts/437_intake_link_method_values.sql

begin;

-- ── 1. Let the intake row say how it was linked ─────────────────────────
alter table public.jotform_intake_submissions
  drop constraint if exists jotform_intake_submissions_link_method_check;

alter table public.jotform_intake_submissions
  add constraint jotform_intake_submissions_link_method_check
  check (link_method is null or link_method in (
    'auto_email',
    'auto_business_name',
    'auto_name',
    'auto_karbon_match',
    'auto_karbon_created',
    'auto_hub_created',
    'manual'
  ));

comment on column public.jotform_intake_submissions.link_method is
  'How this intake was linked to a client: auto_email | auto_business_name | '
  'auto_name (matched an existing client), auto_karbon_match | '
  'auto_karbon_created | auto_hub_created (resolved or created during '
  'ingest), manual (a teammate chose it — never overwritten automatically), '
  'NULL (unlinked).';

-- ── 2. Link the intakes whose contact already exists ────────────────────
update public.jotform_intake_submissions t
set contact_id  = m.cid,
    link_method = 'auto_email',
    linked_at   = now(),
    link_error  = null
from (
  select j.id,
    (select c.id from public.contacts c
      where lower(trim(c.primary_email)) = lower(trim(j.submitter_email))
        and coalesce(c.status, '') <> 'Deleted') as cid
  from public.jotform_intake_submissions j
  where j.contact_id is null
    and j.organization_id is null
    and j.link_method is null
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
  and t.organization_id is null
  and t.link_method is null;

commit;
