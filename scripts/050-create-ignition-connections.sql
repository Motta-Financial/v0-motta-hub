-- Ignition Reporting API OAuth connection.
--
-- Ignition's OAuth grants practice-wide access (a single admin authorizes the
-- app and the resulting tokens can read every reporting endpoint for the entire
-- practice), so we model this as a single-row table with a UNIQUE constraint on
-- a constant `singleton` column. This keeps the upsert logic simple and prevents
-- duplicate connections from being created accidentally.
--
-- team_member_id captures *who* installed the app (for attribution/audit),
-- but tokens are not scoped to that user — anyone with access to the practice
-- can use the connection.

create table if not exists public.ignition_connections (
  id uuid primary key default gen_random_uuid(),

  -- Singleton enforcement: there is only ever one Ignition connection per
  -- practice. We use a CHECK + UNIQUE so an upsert can always target the
  -- same row regardless of who is calling.
  singleton boolean not null default true,

  -- Who clicked "Connect" — purely informational.
  team_member_id uuid references public.team_members(id) on delete set null,

  -- OAuth credentials. access_token typically lives ~1h, refresh_token ~90d.
  access_token text not null,
  refresh_token text not null,
  token_type text,
  expires_at timestamptz not null,
  scope text,

  -- Identifying info pulled from the first API call after connect, if Ignition
  -- exposes a /me-style endpoint. Left nullable because the only "free" call
  -- in the reporting API is the list endpoints themselves.
  ignition_practice_id text,
  ignition_practice_name text,
  ignition_user_email text,
  ignition_user_name text,

  -- Connection health.
  is_active boolean not null default true,
  sync_enabled boolean not null default true,
  last_synced_at timestamptz,
  last_sync_started_at timestamptz,
  last_sync_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ignition_connections_singleton_only check (singleton = true)
);

create unique index if not exists ignition_connections_singleton_idx
  on public.ignition_connections (singleton);

-- Standard updated_at trigger to keep the column honest.
create or replace function public.set_updated_at_ignition_connections()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_ignition_connections_updated_at on public.ignition_connections;
create trigger trg_ignition_connections_updated_at
  before update on public.ignition_connections
  for each row execute function public.set_updated_at_ignition_connections();

-- RLS: any authenticated user can read the practice-level connection (so the
-- admin UI works for everyone with a Hub login) but only authenticated users
-- can write. The OAuth routes already run server-side with the SSR client, so
-- they go through these policies as the calling user.
alter table public.ignition_connections enable row level security;

drop policy if exists ignition_connections_select on public.ignition_connections;
create policy ignition_connections_select on public.ignition_connections
  for select
  to authenticated
  using (true);

drop policy if exists ignition_connections_insert on public.ignition_connections;
create policy ignition_connections_insert on public.ignition_connections
  for insert
  to authenticated
  with check (true);

drop policy if exists ignition_connections_update on public.ignition_connections;
create policy ignition_connections_update on public.ignition_connections
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists ignition_connections_delete on public.ignition_connections;
create policy ignition_connections_delete on public.ignition_connections
  for delete
  to authenticated
  using (true);
