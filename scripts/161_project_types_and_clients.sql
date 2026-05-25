-- =============================================================================
-- Project Types, Project Templates, and Multi-Client linking
-- =============================================================================
-- Karbon ships two pieces of metadata that are a perfect basis for our
-- "Project Type" / "Project Template" model:
--
--   work_types       — 41 firm-wide categories ("ACCT | Bookkeeping",
--                      "TAX | Individual (1040)", "ADVS | Advisory", …)
--   work_templates   — published Karbon templates that an operator can
--                      start a work item from. Each template is tied to
--                      a work_type via karbon_work_type_key.
--
-- Rather than create a parallel project_types table that we'd have to keep
-- in sync with Karbon, we adopt the Karbon tables as the source of truth
-- and store soft references (text keys) on `projects`.
--
-- We also break the "one project = one client" assumption: a tax return
-- project commonly involves multiple contacts (joint filers + dependents)
-- AND an organization (an LLC owned by the same family), and a single
-- engagement project may legitimately span an organization + its officers.
-- The `projects.organization_id` / `projects.contact_id` columns stay as
-- the *primary* client mirror (so existing API surface keeps working) but
-- the canonical list lives in `project_clients`.
--
-- This migration is idempotent and safe to re-run.
-- =============================================================================

-- ── Project type / template references on `projects` ───────────────────────
alter table public.projects
  add column if not exists project_type_key      text,
  add column if not exists project_template_key  text;

-- Soft FKs (text → text). We don't enforce ON DELETE because work_types /
-- work_templates are sync'd from Karbon and we never want a Karbon delete
-- to cascade-delete a Hub project.
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'projects_project_type_key_fkey'
  ) then
    alter table public.projects
      add constraint projects_project_type_key_fkey
        foreign key (project_type_key)
        references public.work_types(karbon_work_type_key)
        on update cascade on delete set null;
  end if;

  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'projects_project_template_key_fkey'
  ) then
    alter table public.projects
      add constraint projects_project_template_key_fkey
        foreign key (project_template_key)
        references public.work_templates(karbon_work_template_key)
        on update cascade on delete set null;
  end if;
end$$;

create index if not exists projects_project_type_key_idx     on public.projects (project_type_key);
create index if not exists projects_project_template_key_idx on public.projects (project_template_key);

-- ── project_clients (multi-client linkage) ─────────────────────────────────
-- Every project has 1..N rows here. Exactly one of (organization_id, contact_id)
-- is set per row. Exactly one row per project is `is_primary`.
create table if not exists public.project_clients (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,

  organization_id uuid references public.organizations(id) on delete cascade,
  contact_id      uuid references public.contacts(id)      on delete cascade,

  -- Role of this client on the project. Free-form, but typical values:
  --   'primary'     — the lead client / billing entity
  --   'spouse'      — joint 1040 filer
  --   'dependent'   — listed dependent on a 1040
  --   'related_business' — owner's LLC, etc.
  --   'officer'     — listed officer on a 1120 / 990
  --   'beneficiary' — trust / estate beneficiary
  --   'shareholder' / 'partner'
  role            text not null default 'primary',
  is_primary      boolean not null default false,

  -- Optional — useful for tax workpapers / bookkeeping splits
  ownership_pct   numeric(5,2),

  notes           text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint project_clients_one_kind
    check ((organization_id is not null)::int + (contact_id is not null)::int = 1)
);

-- A given project should not list the same client twice (even with
-- different roles — easier to enforce here, can be revisited later).
create unique index if not exists project_clients_unique_org
  on public.project_clients (project_id, organization_id)
  where organization_id is not null;
create unique index if not exists project_clients_unique_contact
  on public.project_clients (project_id, contact_id)
  where contact_id is not null;

-- Exactly one primary per project.
create unique index if not exists project_clients_one_primary
  on public.project_clients (project_id)
  where is_primary;

create index if not exists project_clients_org_idx     on public.project_clients (organization_id);
create index if not exists project_clients_contact_idx on public.project_clients (contact_id);

alter table public.project_clients enable row level security;
drop policy if exists "Allow all on project_clients" on public.project_clients;
create policy "Allow all on project_clients" on public.project_clients
  for all using (true) with check (true);

-- updated_at trigger
create or replace function public.project_clients_set_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists project_clients_set_updated_at on public.project_clients;
create trigger project_clients_set_updated_at
  before update on public.project_clients
  for each row execute function public.project_clients_set_updated_at();

-- ── Backfill existing projects ─────────────────────────────────────────────
-- One row per existing project, marked primary.
insert into public.project_clients (project_id, organization_id, contact_id, role, is_primary)
select
  p.id,
  p.organization_id,
  p.contact_id,
  'primary',
  true
from public.projects p
where (p.organization_id is not null or p.contact_id is not null)
  and not exists (
    select 1 from public.project_clients pc
    where pc.project_id = p.id and pc.is_primary
  )
on conflict do nothing;

-- ── Map legacy `kind` → `project_type_key` where we can ─────────────────
-- The kinds we used pre-migration were free-form strings; map the common
-- ones to a Karbon work_type. Anything we can't map stays NULL and the
-- operator can pick a type from the UI.
update public.projects p
set project_type_key = wt.karbon_work_type_key
from public.work_types wt
where p.project_type_key is null
  and (
    (p.kind = 'monthly_bookkeeping'   and wt.name = 'ACCT | Bookkeeping') or
    (p.kind = 'quarterly_bookkeeping' and wt.name = 'ACCT | Bookkeeping') or
    (p.kind = 'payroll'               and wt.name = 'ACCT | Payroll') or
    (p.kind = 'advisory'              and wt.name = 'ADVS | Advisory') or
    (p.kind = 'onboarding'            and wt.name in ('ACCT | Onboarding (BKPG)','ACCT | Onboarding (PYRL)'))
  );

-- ── Enriched view for list/detail endpoints ───────────────────────────────
-- One row per project with: aggregated client display info, work_type name,
-- and template title. Keeps API code simple and matches the
-- `proconnect_engagements_enriched` / `clients_unified` convention.
create or replace view public.projects_enriched as
select
  p.*,
  wt.name              as project_type_name,
  wt.is_active         as project_type_active,
  tmpl.title           as project_template_title,
  tmpl.is_active       as project_template_active,
  -- Aggregate clients (in stable order: primary first, then by role/name).
  coalesce(
    (
      select jsonb_agg(jsonb_build_object(
        'id', pc.id,
        'kind', case when pc.organization_id is not null then 'organization' else 'contact' end,
        'client_id', coalesce(pc.organization_id, pc.contact_id),
        'name', coalesce(o.name, o.full_name, c.full_name, 'Unknown'),
        'role', pc.role,
        'is_primary', pc.is_primary,
        'ownership_pct', pc.ownership_pct,
        'karbon_url', coalesce(o.karbon_url, c.karbon_url)
      ) order by pc.is_primary desc, pc.role, coalesce(o.name, c.full_name))
      from public.project_clients pc
      left join public.organizations o on o.id = pc.organization_id
      left join public.contacts c      on c.id = pc.contact_id
      where pc.project_id = p.id
    ),
    '[]'::jsonb
  ) as clients
from public.projects p
left join public.work_types     wt   on wt.karbon_work_type_key     = p.project_type_key
left join public.work_templates tmpl on tmpl.karbon_work_template_key = p.project_template_key;

comment on view public.projects_enriched is
  'Projects joined with work_types (project type), work_templates (project template), and aggregated project_clients.';
