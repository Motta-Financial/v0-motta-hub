-- 380: Close the client-mapping gap feeding the Sales Dashboard.
--
-- A coverage audit (2026-08-05, post-full-backfill) found 173 of 1,058
-- active proposals with no organization_id/contact_id link:
--   · 100 already have a matched ignition_clients row — the FK cascade
--     simply never ran for them (they predate apply_ignition_client_match).
--   · 73 sit behind 64 ignition_clients rows that the auto-matcher left
--     unmatched even though 52 resolve uniquely by email and most of the
--     rest by exact name.
--
-- This migration re-runs the same matching rules as the live matcher and
-- scripts/match-ignition-clients-by-email.ts (same match_method /
-- match_confidence values, so these rows are indistinguishable from
-- sync-time matches), then cascades every ignition_clients link onto
-- proposals / invoices / payments where the FK is still null, and upserts
-- the master client_mapping rows.
--
-- Every pass matches ONLY on unique hits — an email or name that resolves
-- to more than one contact/organization is left unmatched for manual
-- review in /admin/ignition. No existing link is ever overwritten.

-- ────────────────────────────────────────────────────────────────────────
-- 1a. Email → unique contacts.primary_email  (confidence 0.85)
-- ────────────────────────────────────────────────────────────────────────
update public.ignition_clients ic
set contact_id       = m.matched_id,
    match_status     = 'auto_matched',
    match_method     = 'email',
    match_confidence = 0.85,
    match_notes      = coalesce(ic.match_notes || E'\n', '') ||
                       'auto-matched by migration 380 (email → contacts.primary_email) on ' || now()::text,
    updated_at       = now()
from (
  select u.ignition_client_id, max(c.id::text)::uuid as matched_id
  from public.ignition_clients u
  join public.contacts c on lower(trim(c.primary_email)) = lower(trim(u.email))
  where (u.match_status is null or u.match_status = 'unmatched')
    and u.email is not null and trim(u.email) <> ''
  group by u.ignition_client_id
  having count(distinct c.id) = 1
) m
where ic.ignition_client_id = m.ignition_client_id;

-- ────────────────────────────────────────────────────────────────────────
-- 1b. Email → unique contacts.secondary_email  (confidence 0.85)
-- ────────────────────────────────────────────────────────────────────────
update public.ignition_clients ic
set contact_id       = m.matched_id,
    match_status     = 'auto_matched',
    match_method     = 'email',
    match_confidence = 0.85,
    match_notes      = coalesce(ic.match_notes || E'\n', '') ||
                       'auto-matched by migration 380 (email → contacts.secondary_email) on ' || now()::text,
    updated_at       = now()
from (
  select u.ignition_client_id, max(c.id::text)::uuid as matched_id
  from public.ignition_clients u
  join public.contacts c on lower(trim(c.secondary_email)) = lower(trim(u.email))
  where (u.match_status is null or u.match_status = 'unmatched')
    and u.email is not null and trim(u.email) <> ''
  group by u.ignition_client_id
  having count(distinct c.id) = 1
) m
where ic.ignition_client_id = m.ignition_client_id;

-- ────────────────────────────────────────────────────────────────────────
-- 1c. Email → unique organizations.primary_email  (confidence 0.85)
-- ────────────────────────────────────────────────────────────────────────
update public.ignition_clients ic
set organization_id  = m.matched_id,
    match_status     = 'auto_matched',
    match_method     = 'email',
    match_confidence = 0.85,
    match_notes      = coalesce(ic.match_notes || E'\n', '') ||
                       'auto-matched by migration 380 (email → organizations.primary_email) on ' || now()::text,
    updated_at       = now()
from (
  select u.ignition_client_id, max(o.id::text)::uuid as matched_id
  from public.ignition_clients u
  join public.organizations o on lower(trim(o.primary_email)) = lower(trim(u.email))
  where (u.match_status is null or u.match_status = 'unmatched')
    and u.email is not null and trim(u.email) <> ''
  group by u.ignition_client_id
  having count(distinct o.id) = 1
) m
where ic.ignition_client_id = m.ignition_client_id;

-- ────────────────────────────────────────────────────────────────────────
-- 2a. Exact business/display name → unique organizations.name
--     (confidence 0.70 — name matches are weaker signals than email)
-- ────────────────────────────────────────────────────────────────────────
update public.ignition_clients ic
set organization_id  = m.matched_id,
    match_status     = 'auto_matched',
    match_method     = 'name_lookup',
    match_confidence = 0.70,
    match_notes      = coalesce(ic.match_notes || E'\n', '') ||
                       'auto-matched by migration 380 (exact name → organizations.name) on ' || now()::text,
    updated_at       = now()
from (
  select u.ignition_client_id, max(o.id::text)::uuid as matched_id
  from public.ignition_clients u
  join public.organizations o
    on lower(trim(o.name)) = lower(trim(coalesce(u.business_name, u.name)))
  where (u.match_status is null or u.match_status = 'unmatched')
    and coalesce(u.business_name, u.name) is not null
  group by u.ignition_client_id
  having count(distinct o.id) = 1
) m
where ic.ignition_client_id = m.ignition_client_id;

-- ────────────────────────────────────────────────────────────────────────
-- 2b. Exact person name → unique contacts.full_name  (confidence 0.70)
-- ────────────────────────────────────────────────────────────────────────
update public.ignition_clients ic
set contact_id       = m.matched_id,
    match_status     = 'auto_matched',
    match_method     = 'name_lookup',
    match_confidence = 0.70,
    match_notes      = coalesce(ic.match_notes || E'\n', '') ||
                       'auto-matched by migration 380 (exact name → contacts.full_name) on ' || now()::text,
    updated_at       = now()
from (
  select u.ignition_client_id, max(c.id::text)::uuid as matched_id
  from public.ignition_clients u
  join public.contacts c on lower(trim(c.full_name)) = lower(trim(u.name))
  where (u.match_status is null or u.match_status = 'unmatched')
    and u.name is not null
  group by u.ignition_client_id
  having count(distinct c.id) = 1
) m
where ic.ignition_client_id = m.ignition_client_id;

-- ────────────────────────────────────────────────────────────────────────
-- 3. Cascade every ignition_clients link onto downstream tables where the
--    FK is still null. This heals the 100 pre-existing gaps AND everything
--    matched above, and never clobbers a more specific manual override.
-- ────────────────────────────────────────────────────────────────────────
update public.ignition_proposals p
set contact_id = ic.contact_id
from public.ignition_clients ic
where p.ignition_client_id = ic.ignition_client_id
  and p.contact_id is null and p.organization_id is null
  and ic.contact_id is not null;

update public.ignition_proposals p
set organization_id = ic.organization_id
from public.ignition_clients ic
where p.ignition_client_id = ic.ignition_client_id
  and p.contact_id is null and p.organization_id is null
  and ic.organization_id is not null;

update public.ignition_invoices i
set contact_id = ic.contact_id
from public.ignition_clients ic
where i.ignition_client_id = ic.ignition_client_id
  and i.contact_id is null and i.organization_id is null
  and ic.contact_id is not null;

update public.ignition_invoices i
set organization_id = ic.organization_id
from public.ignition_clients ic
where i.ignition_client_id = ic.ignition_client_id
  and i.contact_id is null and i.organization_id is null
  and ic.organization_id is not null;

update public.ignition_payments pay
set contact_id = ic.contact_id
from public.ignition_clients ic
where pay.ignition_client_id = ic.ignition_client_id
  and pay.contact_id is null and pay.organization_id is null
  and ic.contact_id is not null;

update public.ignition_payments pay
set organization_id = ic.organization_id
from public.ignition_clients ic
where pay.ignition_client_id = ic.ignition_client_id
  and pay.contact_id is null and pay.organization_id is null
  and ic.organization_id is not null;

-- ────────────────────────────────────────────────────────────────────────
-- 4. Master mapping upsert — same three-step pattern as migration 378:
--    client_mapping.internal_client_id has an FK → internal_clients(id)
--    (where internal_clients.id IS the contacts.id / organizations.id
--    uuid), so canonical internal_clients rows must exist first. Org wins
--    when a client links to both (the org is the client entity; the
--    person is its owner/contact).
-- ────────────────────────────────────────────────────────────────────────
insert into public.internal_clients
  (id, display_name, client_type, primary_contact_id, status, normalized_name, primary_email)
select
  c.id,
  coalesce(nullif(trim(c.full_name), ''),
           nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''),
           '(unnamed)'),
  'PERSON',
  c.id,
  'active',
  lower(coalesce(nullif(trim(c.full_name), ''),
                 nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''),
                 '(unnamed)')),
  c.primary_email
from public.contacts c
where exists (
    select 1 from public.ignition_clients ic
    where ic.contact_id = c.id and ic.organization_id is null
  )
  and not exists (select 1 from public.internal_clients i where i.id = c.id);

insert into public.internal_clients
  (id, display_name, client_type, primary_organization_id, status, normalized_name, primary_email)
select
  o.id,
  coalesce(nullif(trim(o.name), ''), '(unnamed)'),
  'ORGANIZATION',
  o.id,
  'active',
  lower(coalesce(nullif(trim(o.name), ''), '(unnamed)')),
  o.primary_email
from public.organizations o
where exists (
    select 1 from public.ignition_clients ic where ic.organization_id = o.id
  )
  and not exists (select 1 from public.internal_clients i where i.id = o.id);

insert into public.client_mapping
  (internal_client_id, ignition_client_id, client_type, source_system, created_at, updated_at)
select
  coalesce(ic.organization_id, ic.contact_id),
  ic.ignition_client_id,
  case when ic.organization_id is not null then 'ORGANIZATION' else 'PERSON' end,
  'IGNITION',
  now(), now()
from public.ignition_clients ic
where (ic.contact_id is not null or ic.organization_id is not null)
  and exists (
    select 1 from public.internal_clients i
    where i.id = coalesce(ic.organization_id, ic.contact_id)
  )
  and not exists (
    select 1 from public.client_mapping cm
    where cm.ignition_client_id = ic.ignition_client_id
  );
