-- ============================================================================
-- 170_tax_client_relationships.sql
-- Link 1040 individual filers to business/org clients (1065/1120/1120-S/990)
--
-- See plan: v0_plans/deep-guide.md
-- - tax_client_relationships:        confirmed/needs_review links
-- - tax_client_relationship_signals: full audit of every signal observed
-- - tax_client_relationships_enriched: convenience view with display names
--
-- Convention (mirrors ALFRED Calendly/Zoom triage in user memory):
--   confidence >= 0.85 → 'confirmed' on auto-insert (only after first
--                        operator review pass; see plan)
--   0.5–0.85          → 'needs_review'
--   < 0.5             → 'needs_review' (queued; can be auto-rejected
--                        if no other signals)
--
-- link_source vocabulary (uniform across hub auto-link tables):
--   'auto'            → extractor inserted from return data
--   'manual'          → operator created via UI
--   'alfred'          → AI-driven match (future)
--   'hub_fallback'    → derived from contact_organizations / legacy IDs
-- ============================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ──────────────────────────────────────────────────────────────────────────
-- Confirmed / needs_review / rejected links
-- Always stores PERSON in person_client_id, ORGANIZATION in org_client_id.
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists tax_client_relationships (
  id uuid primary key default gen_random_uuid(),
  person_client_id  text not null
    references proconnect_clients(proconnect_client_id) on delete cascade,
  org_client_id     text not null
    references proconnect_clients(proconnect_client_id) on delete cascade,
  -- 'owner' | 'shareholder' | 'partner' | 'officer' | 'beneficiary' | 'unknown'
  relationship_type text not null default 'unknown',
  ownership_pct     numeric(5,2),
  -- 'confirmed' | 'needs_review' | 'rejected'
  status            text not null default 'needs_review',
  confidence        numeric(4,3) not null,
  link_source       text not null,
  reviewed_by       uuid references team_members(id),
  reviewed_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint tax_client_relationships_unique unique (person_client_id, org_client_id),
  constraint tax_client_relationships_status_chk
    check (status in ('confirmed', 'needs_review', 'rejected')),
  constraint tax_client_relationships_link_source_chk
    check (link_source in ('auto', 'manual', 'alfred', 'hub_fallback'))
);

create index if not exists tax_client_relationships_person_idx
  on tax_client_relationships (person_client_id);
create index if not exists tax_client_relationships_org_idx
  on tax_client_relationships (org_client_id);
create index if not exists tax_client_relationships_status_idx
  on tax_client_relationships (status);

-- updated_at trigger
create or replace function tax_client_relationships_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tax_client_relationships_updated_at on tax_client_relationships;
create trigger tax_client_relationships_updated_at
  before update on tax_client_relationships
  for each row execute function tax_client_relationships_set_updated_at();

-- ──────────────────────────────────────────────────────────────────────────
-- Audit trail of every signal observed (immutable rows).
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists tax_client_relationship_signals (
  id uuid primary key default gen_random_uuid(),
  relationship_id  uuid references tax_client_relationships(id) on delete set null,
  person_client_id text not null,
  org_client_id    text,
  -- 'k1_ein' | 'k1_name' | 'k1_name_fuzzy' | 'sch_e_partnership_ein'
  -- | 'sch_c_owner' | 'business_owner_ssn' | 'business_owner_name'
  -- | 'hub_contact_org' | 'hub_legacy_id'
  signal_type      text not null,
  matched_value    text,
  source_engagement_id uuid references proconnect_engagements(id) on delete set null,
  source_tax_year  int,
  confidence_contribution numeric(4,3) not null,
  created_at       timestamptz not null default now()
);

create index if not exists tax_client_relationship_signals_person_idx
  on tax_client_relationship_signals (person_client_id);
create index if not exists tax_client_relationship_signals_org_idx
  on tax_client_relationship_signals (org_client_id);
create index if not exists tax_client_relationship_signals_rel_idx
  on tax_client_relationship_signals (relationship_id);

-- ──────────────────────────────────────────────────────────────────────────
-- Enriched view — pre-joins display names and client states so the UI
-- doesn't re-do the join (mirrors proconnect_engagements_enriched).
-- ──────────────────────────────────────────────────────────────────────────
create or replace view tax_client_relationships_enriched as
select
  r.id,
  r.person_client_id,
  r.org_client_id,
  r.relationship_type,
  r.ownership_pct,
  r.status,
  r.confidence,
  r.link_source,
  r.reviewed_by,
  r.reviewed_at,
  r.created_at,
  r.updated_at,
  -- person side
  p.display_name        as person_display_name,
  p.first_name          as person_first_name,
  p.last_name           as person_last_name,
  p.email               as person_email,
  p.client_state        as person_client_state,
  p.state               as person_state,
  -- org side
  o.display_name        as org_display_name,
  o.business_name       as org_business_name,
  o.email               as org_email,
  o.client_state        as org_client_state,
  o.state               as org_state,
  -- reviewer
  tm.full_name          as reviewer_name,
  -- signal summary
  (
    select count(*) from tax_client_relationship_signals s
    where s.relationship_id = r.id
  ) as signal_count,
  (
    select array_agg(distinct s.signal_type order by s.signal_type)
    from tax_client_relationship_signals s
    where s.relationship_id = r.id
  ) as signal_types
from tax_client_relationships r
left join proconnect_clients p on p.proconnect_client_id = r.person_client_id
left join proconnect_clients o on o.proconnect_client_id = r.org_client_id
left join team_members tm on tm.id = r.reviewed_by;

comment on table tax_client_relationships is
  'Confirmed / needs_review links between PERSON and ORGANIZATION ProConnect clients (1040 ↔ 1065/1120/1120S/990).';
comment on table tax_client_relationship_signals is
  'Immutable audit trail of every relationship signal observed. Rows persist even after the parent relationship is rejected.';
comment on view tax_client_relationships_enriched is
  'tax_client_relationships joined with display names + signal summary for UI.';
