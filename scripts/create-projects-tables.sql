-- =============================================================================
-- Projects + Client Systems
-- =============================================================================
-- Adds a lightweight Project layer that groups recurring Karbon work items
-- (e.g. 12 monthly bookkeeping work items / year) into a single "engagement"
-- record so a teammate can open one page and see the entire scope of work for
-- a client.
--
-- Design notes
-- ------------
-- * A project belongs to ONE client (organization or contact, not both).
-- * Work items are NOT linked via a join table. Instead each project stores
--   the patterns (`work_type_pattern`, `work_template_pattern`) that identify
--   its work items so that new Karbon work items synced going forward are
--   automatically picked up by the project detail page (no backfill needed).
-- * Ignition services are similarly derived live from the proposal-service
--   rows tied to the same client.
-- * `project_systems` is the only piece of project metadata that has no other
--   home in the schema — it stores freeform "Client Systems" background info
--   (QuickBooks Online URL, Gusto login, Stripe account, etc.).
--
-- The Monthly Bookkeeping seed at the bottom of this file is idempotent — it
-- can be re-run safely after new clients are added in Karbon.
-- =============================================================================

create extension if not exists "pgcrypto";

-- ── projects ────────────────────────────────────────────────────────────────
create table if not exists public.projects (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  kind                   text not null default 'custom',
    -- 'monthly_bookkeeping' | 'quarterly_bookkeeping' | 'tax_return'
    -- | 'payroll' | 'advisory' | 'onboarding' | 'custom'
  status                 text not null default 'active',
    -- 'active' | 'paused' | 'completed' | 'archived'
  description            text,

  organization_id        uuid references public.organizations(id) on delete cascade,
  contact_id             uuid references public.contacts(id)      on delete cascade,

  -- Live auto-attach rules. Both columns are case-insensitive substring
  -- matches against work_items.work_type / work_items.work_template_name.
  -- A NULL value disables that filter. At least one of these is expected to
  -- be set for projects that should track work items.
  work_type_pattern      text,
  work_template_pattern  text,

  start_date             date,
  end_date               date,

  -- Operator who owns the project (assigned manager). Optional.
  owner_team_member_id   uuid references public.team_members(id) on delete set null,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint projects_one_client_kind
    check (organization_id is not null or contact_id is not null)
);

create index if not exists projects_organization_id_idx on public.projects (organization_id);
create index if not exists projects_contact_id_idx       on public.projects (contact_id);
create index if not exists projects_kind_idx             on public.projects (kind);
create index if not exists projects_status_idx           on public.projects (status);

-- Prevent duplicate auto-seeded projects per client + kind. (We intentionally
-- allow multiple "custom" projects per client.)
create unique index if not exists projects_unique_org_kind
  on public.projects (organization_id, kind)
  where organization_id is not null and kind <> 'custom';

create unique index if not exists projects_unique_contact_kind
  on public.projects (contact_id, kind)
  where contact_id is not null and kind <> 'custom';

alter table public.projects enable row level security;
drop policy if exists "Allow all on projects" on public.projects;
create policy "Allow all on projects" on public.projects for all using (true) with check (true);

-- ── project_systems (Client Systems background) ─────────────────────────────
create table if not exists public.project_systems (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  name         text not null,
    -- e.g. "QuickBooks Online", "Gusto", "Stripe", "Ramp", "Bill.com"
  system_type  text,
    -- 'accounting' | 'payroll' | 'payments' | 'banking' | 'crm'
    -- | 'tax' | 'document_storage' | 'other'
  url          text,
  username     text,         -- non-sensitive lookup label only (never store passwords here)
  notes        text,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists project_systems_project_id_idx on public.project_systems (project_id);

alter table public.project_systems enable row level security;
drop policy if exists "Allow all on project_systems" on public.project_systems;
create policy "Allow all on project_systems" on public.project_systems for all using (true) with check (true);

-- ── updated_at trigger helper (shared) ──────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

drop trigger if exists project_systems_set_updated_at on public.project_systems;
create trigger project_systems_set_updated_at
  before update on public.project_systems
  for each row execute function public.set_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- Seed: Monthly Bookkeeping projects
-- ────────────────────────────────────────────────────────────────────────────
-- For every distinct client (organization preferred, contact fallback) that
-- currently has at least one work item tagged Monthly Bookkeeping, create a
-- 'monthly_bookkeeping' project with the appropriate auto-attach pattern.
-- Idempotent via the partial unique indexes above.
-- ────────────────────────────────────────────────────────────────────────────
-- Organizations
insert into public.projects
  (name, kind, status, organization_id, contact_id,
   work_type_pattern, work_template_pattern, start_date, description)
select
  coalesce(o.name, o.full_name, wi.client_name, 'Untitled') || ' — Monthly Bookkeeping' as name,
  'monthly_bookkeeping' as kind,
  'active'              as status,
  wi.organization_id,
  null::uuid            as contact_id,
  'Bookkeeping'         as work_type_pattern,
  'Monthly Bookkeeping' as work_template_pattern,
  min(wi.start_date)    as first_period,
  'Auto-created from existing Karbon Monthly Bookkeeping work items.'
from public.work_items wi
join public.organizations o on o.id = wi.organization_id
where wi.organization_id is not null
  and (wi.work_template_name ilike '%Monthly Bookkeeping%' or wi.title ilike '%Monthly Bookkeeping%')
  and wi.deleted_in_karbon_at is null
group by wi.organization_id, o.name, o.full_name, wi.client_name
on conflict do nothing;

-- Contacts (only if no organization linked on the work item)
insert into public.projects
  (name, kind, status, organization_id, contact_id,
   work_type_pattern, work_template_pattern, start_date, description)
select
  coalesce(c.full_name, wi.client_name, 'Untitled') || ' — Monthly Bookkeeping' as name,
  'monthly_bookkeeping' as kind,
  'active'              as status,
  null::uuid            as organization_id,
  wi.contact_id,
  'Bookkeeping'         as work_type_pattern,
  'Monthly Bookkeeping' as work_template_pattern,
  min(wi.start_date)    as first_period,
  'Auto-created from existing Karbon Monthly Bookkeeping work items.'
from public.work_items wi
join public.contacts c on c.id = wi.contact_id
where wi.contact_id is not null
  and wi.organization_id is null
  and (wi.work_template_name ilike '%Monthly Bookkeeping%' or wi.title ilike '%Monthly Bookkeeping%')
  and wi.deleted_in_karbon_at is null
group by wi.contact_id, c.full_name, wi.client_name
on conflict do nothing;
