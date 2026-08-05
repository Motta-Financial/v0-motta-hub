-- 378: Backfill client_mapping from ignition_clients' direct Hub links.
--
-- The Ignition matcher writes its links onto ignition_clients.contact_id /
-- ignition_clients.organization_id, but only some of those links ever made
-- it into client_mapping (the table master_client_mapping pivots from).
-- Found: 556 linked ignition_clients rows vs only 242 client_mapping rows
-- with an ignition_client_id — 314 distinct ignition clients invisible to
-- the master mapping.
--
-- Constraints that shape this backfill:
--   * client_mapping_ignition_uniq: at most ONE mapping row per
--     ignition_client_id. When an ignition client links to both a contact
--     and an organization, the ORGANIZATION wins (the org is the client
--     entity; the person is its owner/contact — per the firm's model).
--   * client_mapping.internal_client_id FK → internal_clients(id), where
--     internal_clients.id IS the contacts.id / organizations.id uuid.
--     45 linked hub records had no internal_clients row yet — step 1
--     creates them following the existing seeding convention.
--
-- Idempotent: NOT EXISTS guards make re-runs no-ops.

-- ── Step 1a: canonical internal_clients rows for linked PERSONs ─────────
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

-- ── Step 1b: canonical internal_clients rows for linked ORGANIZATIONs ───
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

-- ── Step 2: the mapping rows (org-preferred when both links are set) ────
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
  -- The FK target must exist (guards the handful of hub uuids that are
  -- neither in internal_clients after step 1 — e.g. deleted contacts).
  and exists (
    select 1 from public.internal_clients i
    where i.id = coalesce(ic.organization_id, ic.contact_id)
  )
  and not exists (
    select 1 from public.client_mapping cm
    where cm.ignition_client_id = ic.ignition_client_id
  );
