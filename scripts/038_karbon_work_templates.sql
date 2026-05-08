-- Karbon WorkTemplates cache table.
--
-- Backs the new live sync added in lib/karbon/sync-tenant-config.ts. The
-- /v3/WorkTemplates endpoint exposes the firm's published Karbon work
-- templates (e.g. "TAX | Individual (1040) | Last, First | YYYY"). These
-- rarely change but are referenced when starting new work items, mapping
-- a work item back to the template it came from, and reporting on
-- template usage.
--
-- Existing tables left as-is:
--   work_status   — already populated and shaped correctly. The new
--                   sync code rewrites the parser only.
--   work_types    — schema already exists with admin-curated columns
--                   (service_line_id, default_assignee_id, etc.). The
--                   new sync upserts the 41 Karbon work types and
--                   preserves those curated columns on update.

create table if not exists public.work_templates (
  id uuid primary key default gen_random_uuid(),

  -- Karbon identifiers
  karbon_work_template_key text not null unique,
  karbon_work_type_key     text,        -- nullable: a few "intake" templates
                                        -- have no work type assigned in Karbon
  title       text not null,
  description text,

  -- Karbon-reported metadata (treated as opaque, refreshed on every sync)
  estimated_budget_minutes        integer,
  estimated_time_minutes          integer,
  has_scheduled_client_task_groups boolean,
  draft_has_changes               boolean,
  published_date                  timestamptz,
  date_modified                   timestamptz,
  number_of_work_items_created    integer default 0,
  date_last_work_item_created     timestamptz,

  -- Roles defined on the template ({ ActorKey, ActorName }[])
  actor_roles jsonb default '[]'::jsonb,

  -- Soft-delete flag. The sync flips this to false when a template no
  -- longer appears in the /WorkTemplates response. We never hard-delete
  -- so historical work_items.work_template_key references still resolve.
  is_active boolean not null default true,

  -- Bookkeeping
  last_synced_at timestamptz not null default now(),
  raw_payload    jsonb,                  -- escape hatch for fields we don't
                                         -- yet model (Karbon may add fields
                                         -- between releases)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.work_templates is
  'Mirror of Karbon /v3/WorkTemplates. Refreshed every 4 hours by the karbon-sync cron (lib/karbon/sync-tenant-config.ts).';

-- Common access patterns: lookup by karbon key, filter by work type, and
-- list active templates for a picker.
create index if not exists work_templates_karbon_work_type_key_idx
  on public.work_templates (karbon_work_type_key);

create index if not exists work_templates_is_active_idx
  on public.work_templates (is_active)
  where is_active = true;

-- updated_at trigger so SELECT … ORDER BY updated_at gives stable results
-- even when a row is upserted with no field changes.
create or replace function public.work_templates_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists work_templates_set_updated_at on public.work_templates;
create trigger work_templates_set_updated_at
  before update on public.work_templates
  for each row execute function public.work_templates_set_updated_at();
