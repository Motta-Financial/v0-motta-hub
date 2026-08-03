-- ============================================================================
-- Migration 338: Tax Projects + tax_return_links
-- ----------------------------------------------------------------------------
-- Mirrors the Accounting "Projects" pattern (create-projects-tables.sql) for
-- TAX work. Every Hub client that has ProConnect tax engagements gets ONE
-- 'tax_return' project. Inside that project, every individual tax return
-- (a ProConnect engagement = client x tax_year x return_type) is linked 1:1
-- to its Karbon work item and its Ignition proposal service.
--
--   projects (kind='tax_return')  one per client
--        |
--        +--< tax_return_links     one row per ProConnect engagement/return
--                 |  engagement_id (the PC return UUID)
--                 |  -> work_items.id        (the Karbon work item)
--                 |  -> ignition_proposal_services.id (the proposal line)
--
-- Why a join table (unlike Accounting Projects, which auto-attach work items
-- by substring pattern): a tax project rolls up MANY returns and each return
-- maps to a SPECIFIC work item + proposal. Patterns can't express per-return
-- 1:1 linkage, so we persist it. Auto-matching fills these rows; manual
-- overrides always win and are never clobbered by a later auto pass.
--
-- This migration is idempotent: safe to run multiple times.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. Seed 'tax_return' projects (one per Hub client with engagements)
-- ----------------------------------------------------------------------------
-- Organization preferred, contact fallback. We pattern the project so the
-- generic /projects detail page + list also pick up tax work items
-- automatically (work_template_pattern 'TAX |'). Idempotent via the existing
-- partial unique indexes projects_unique_org_kind / _contact_kind.
-- ----------------------------------------------------------------------------

-- Organizations
insert into public.projects
  (name, kind, status, organization_id, contact_id,
   work_type_pattern, work_template_pattern, description)
select distinct
  coalesce(o.name, o.full_name, pc.display_name, 'Untitled') || ' — Tax' as name,
  'tax_return' as kind,
  'active'     as status,
  pc.hub_organization_id,
  null::uuid   as contact_id,
  'Tax'        as work_type_pattern,
  'TAX |'      as work_template_pattern,
  'Auto-created from ProConnect tax engagements.'
from public.proconnect_engagements e
join public.proconnect_clients pc on pc.proconnect_client_id = e.proconnect_client_id
join public.organizations o on o.id = pc.hub_organization_id
where pc.hub_organization_id is not null
on conflict do nothing;

-- Contacts (only when no organization is linked)
insert into public.projects
  (name, kind, status, organization_id, contact_id,
   work_type_pattern, work_template_pattern, description)
select distinct
  coalesce(ct.full_name, pc.display_name, 'Untitled') || ' — Tax' as name,
  'tax_return' as kind,
  'active'     as status,
  null::uuid   as organization_id,
  pc.hub_contact_id,
  'Tax'        as work_type_pattern,
  'TAX |'      as work_template_pattern,
  'Auto-created from ProConnect tax engagements.'
from public.proconnect_engagements e
join public.proconnect_clients pc on pc.proconnect_client_id = e.proconnect_client_id
join public.contacts ct on ct.id = pc.hub_contact_id
where pc.hub_contact_id is not null
  and pc.hub_organization_id is null
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- 2. tax_return_links — the per-return 1:1 layer
-- ----------------------------------------------------------------------------
create table if not exists public.tax_return_links (
  id                      uuid primary key default gen_random_uuid(),

  -- The ProConnect engagement / return this row represents. This is the
  -- canonical key (one link row per return). We intentionally do NOT add a
  -- hard FK to proconnect_engagements: engagements are re-synced/tombstoned
  -- nightly and we want link history to survive a transient delete.
  engagement_id           text not null unique,
  proconnect_client_id    text,
  tax_year                integer,
  return_type             text,

  -- The Tax Project (one per client) this return rolls up into.
  project_id              uuid references public.projects(id) on delete set null,

  -- Hub master identity (denormalized for fast filtering).
  hub_organization_id     uuid references public.organizations(id) on delete set null,
  hub_contact_id          uuid references public.contacts(id) on delete set null,

  -- Linked Karbon work item.
  work_item_id            uuid references public.work_items(id) on delete set null,
  karbon_work_item_key    text,
  -- 'auto'   -> matched by the deterministic matcher
  -- 'manual' -> set by a human (NEVER overwritten by an auto pass)
  -- 'none'   -> not linked yet
  work_item_link_source   text not null default 'none'
                            check (work_item_link_source in ('auto','manual','none')),
  work_item_confidence    numeric,

  -- Linked Ignition proposal service (the "proposal" for this return).
  proposal_service_id     uuid references public.ignition_proposal_services(id) on delete set null,
  ignition_proposal_id    text,
  proposal_link_source    text not null default 'none'
                            check (proposal_link_source in ('auto','manual','none')),

  -- Overall health of this return's linkage.
  --   linked       -> work item present (proposal optional)
  --   needs_review -> ambiguous auto match that a human should confirm
  --   no_match     -> matcher found nothing
  status                  text not null default 'no_match'
                            check (status in ('linked','needs_review','no_match')),

  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists tax_return_links_project_id_idx   on public.tax_return_links (project_id);
create index if not exists tax_return_links_org_idx          on public.tax_return_links (hub_organization_id);
create index if not exists tax_return_links_contact_idx      on public.tax_return_links (hub_contact_id);
create index if not exists tax_return_links_work_item_idx    on public.tax_return_links (work_item_id);
create index if not exists tax_return_links_status_idx       on public.tax_return_links (status);
create index if not exists tax_return_links_client_idx       on public.tax_return_links (proconnect_client_id);

alter table public.tax_return_links enable row level security;
drop policy if exists "Allow all on tax_return_links" on public.tax_return_links;
create policy "Allow all on tax_return_links" on public.tax_return_links for all using (true) with check (true);

drop trigger if exists tax_return_links_set_updated_at on public.tax_return_links;
create trigger tax_return_links_set_updated_at
  before update on public.tax_return_links
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. Seed empty link rows (one per engagement that maps to a Hub client)
-- ----------------------------------------------------------------------------
-- We pre-create a 'no_match' row for every engagement tied to a Hub client and
-- attach it to that client's tax_return project. The matcher (lib/tax) fills
-- in the work item + proposal afterwards. Idempotent via the unique key.
-- ----------------------------------------------------------------------------
insert into public.tax_return_links
  (engagement_id, proconnect_client_id, tax_year, return_type,
   project_id, hub_organization_id, hub_contact_id, status)
select
  e.engagement_id,
  e.proconnect_client_id,
  e.tax_year,
  e.return_type,
  p.id as project_id,
  pc.hub_organization_id,
  pc.hub_contact_id,
  'no_match' as status
from public.proconnect_engagements e
join public.proconnect_clients pc on pc.proconnect_client_id = e.proconnect_client_id
left join public.projects p
  on p.kind = 'tax_return'
 and (
      (pc.hub_organization_id is not null and p.organization_id = pc.hub_organization_id)
   or (pc.hub_organization_id is null and pc.hub_contact_id is not null and p.contact_id = pc.hub_contact_id)
 )
where (pc.hub_organization_id is not null or pc.hub_contact_id is not null)
on conflict (engagement_id) do nothing;

-- ----------------------------------------------------------------------------
-- 4. tax_return_links_enriched — convenience view for the API
-- ----------------------------------------------------------------------------
create or replace view public.tax_return_links_enriched as
select
  l.*,
  e.engagement_name,
  e.status        as proconnect_status,
  e.work_status   as proconnect_work_status,
  e.efile_status,
  wi.title         as work_item_title,
  wi.work_template_name,
  wi.primary_status as work_item_status,
  wi.karbon_url    as work_item_karbon_url,
  ps.service_name  as proposal_service_name,
  ps.total_amount  as proposal_amount,
  ps.currency      as proposal_currency,
  ps.status        as proposal_status,
  ip.title         as proposal_title,
  ip.status        as proposal_overall_status
from public.tax_return_links l
left join public.proconnect_engagements e on e.engagement_id = l.engagement_id
left join public.work_items wi on wi.id = l.work_item_id
left join public.ignition_proposal_services ps on ps.id = l.proposal_service_id
left join public.ignition_proposals ip on ip.proposal_id = l.ignition_proposal_id;
