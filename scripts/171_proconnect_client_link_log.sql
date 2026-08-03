-- Audit log + provenance for ProConnect ↔ Hub client linking
-- ----------------------------------------------------------
-- Today the BEFORE INSERT/UPDATE trigger in 151_proconnect_auto_link_hub.sql
-- silently writes hub_contact_id / hub_organization_id when it finds an
-- exact email or name match. That covered ~75% of clients but leaves us
-- with 505 unmapped rows that need fuzzier matching + a human review
-- step. This migration:
--
-- 1) Adds tax_proconnect_client_link_log — every proposed/applied/
--    rejected link is auditable, with the algorithm version, score, and
--    the signals that produced it. We never overwrite an operator-
--    confirmed link without leaving a trail.
-- 2) Adds proconnect_clients.link_source so the UI can show whether a
--    row was linked by the legacy trigger (`auto_trigger`), by the new
--    fuzzy matcher (`auto_fuzzy`), or by an operator (`manual`).
-- 3) A trigger to stamp link_source='auto_trigger' on rows the legacy
--    trigger sets, so we don't lose attribution on existing data.

create table if not exists tax_proconnect_client_link_log (
  id uuid primary key default gen_random_uuid(),
  proconnect_client_id text not null
    references proconnect_clients(proconnect_client_id) on delete cascade,
  -- Either side may be set, never both. Mirrors the proconnect_clients
  -- columns so a row can be applied in one update.
  hub_contact_id uuid references contacts(id) on delete set null,
  hub_organization_id uuid references organizations(id) on delete set null,
  -- 'pending'  → suggestion produced by the matcher, awaiting review
  -- 'applied'  → written into proconnect_clients (by matcher or operator)
  -- 'rejected' → operator rejected; matcher will not propose this pair again
  status text not null check (status in ('pending','applied','rejected')),
  -- 0–1 confidence from the matcher
  score numeric(4,3) not null default 0,
  -- 'ein' | 'email' | 'name_exact' | 'name_normalized' | 'name_trigram' | 'manual' | 'legacy_trigger'
  signals jsonb not null default '[]'::jsonb,
  -- Helps roll back a bad batch without re-running every signal
  matcher_version text not null default 'v1',
  acted_by text,
  acted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- Prevents two pending proposals for the same pair (PERSON or BUSINESS)
  constraint tax_proconnect_link_log_one_side check (
    (hub_contact_id is not null and hub_organization_id is null) or
    (hub_contact_id is null and hub_organization_id is not null)
  )
);

create index if not exists idx_tax_pclink_log_status
  on tax_proconnect_client_link_log(status);
create index if not exists idx_tax_pclink_log_pcid
  on tax_proconnect_client_link_log(proconnect_client_id);
create unique index if not exists uq_tax_pclink_log_pending_pair
  on tax_proconnect_client_link_log(
    proconnect_client_id,
    coalesce(hub_contact_id::text, hub_organization_id::text)
  )
  where status = 'pending';

-- Add link_source column for UI provenance + future debugging
alter table proconnect_clients
  add column if not exists link_source text;

comment on column proconnect_clients.link_source is
  'How hub_contact_id / hub_organization_id was set: auto_trigger (legacy 151 trigger), auto_fuzzy (new matcher with high confidence), manual (operator), or null when unlinked.';

-- Backfill existing linked rows so dashboards reflect history
update proconnect_clients
set link_source = 'auto_trigger'
where (hub_contact_id is not null or hub_organization_id is not null)
  and link_source is null;
