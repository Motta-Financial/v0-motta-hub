-- 351_client_portal_auth.sql
-- Real client-portal authentication + database-level RLS scoping.
--
-- Context: portal_users/portal_messages did not exist yet, and RLS on
-- work_items/documents was `USING (true)` -- no scoping at all. Staff use
-- the same Supabase auth.users pool as portal clients (kept apart only by
-- which authorization table has a row for them: team_members vs
-- portal_users), and components/service-pipeline.tsx queries work_items
-- directly from the browser as staff, so policies must let staff through
-- too, not just "clients only".

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------

create table if not exists public.portal_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  is_active boolean not null default true,
  invited_by uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

comment on table public.portal_users is
  'Client-portal login accounts. Separate from team_members, which authorizes staff. Both share the auth.users identity pool.';

-- One login can be linked to multiple client entities (e.g. a business
-- owner with both a personal contact record and a company record).
create table if not exists public.portal_user_access (
  id uuid primary key default gen_random_uuid(),
  portal_user_id uuid not null references public.portal_users(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint portal_user_access_exactly_one_entity check (
    (contact_id is not null and organization_id is null)
    or (contact_id is null and organization_id is not null)
  )
);

create unique index if not exists portal_user_access_unique_contact
  on public.portal_user_access (portal_user_id, contact_id)
  where contact_id is not null;

create unique index if not exists portal_user_access_unique_org
  on public.portal_user_access (portal_user_id, organization_id)
  where organization_id is not null;

create index if not exists portal_user_access_contact_idx on public.portal_user_access (contact_id);
create index if not exists portal_user_access_org_idx on public.portal_user_access (organization_id);

comment on table public.portal_user_access is
  'Join table: which contact/organization records a portal login may see. Exactly one of contact_id/organization_id per row.';

-- Messages page currently has nothing to read from -- this table was
-- referenced by app/api/client-portal/messages/route.ts but never created.
create table if not exists public.portal_messages (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references public.contacts(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  sender_portal_user_id uuid references public.portal_users(id) on delete set null,
  sender_team_member_id uuid references public.team_members(id) on delete set null,
  sender_role text not null check (sender_role in ('client', 'team_member')),
  sender_name text not null,
  body text not null,
  created_at timestamptz not null default now(),
  constraint portal_messages_exactly_one_entity check (
    (contact_id is not null and organization_id is null)
    or (contact_id is null and organization_id is not null)
  )
);

create index if not exists portal_messages_contact_idx on public.portal_messages (contact_id);
create index if not exists portal_messages_org_idx on public.portal_messages (organization_id);

alter table public.portal_users enable row level security;
alter table public.portal_user_access enable row level security;
alter table public.portal_messages enable row level security;

-- portal_task_comments was created earlier this session with a loose,
-- unused `client_id uuid` column (no FK, no defined scoping meaning) and
-- RLS enabled but zero policies (which currently denies everyone). Drop
-- the column -- scoping is derived by joining work_item_id -> work_items
-- instead, same as every other client-scoped table here.
alter table public.portal_task_comments drop column if exists client_id;

-- ---------------------------------------------------------------------
-- 2. Helper functions (SECURITY DEFINER + fixed search_path so RLS
--    policies can call them without recursive-policy errors or search
--    path hijacking).
-- ---------------------------------------------------------------------

create or replace function public.is_staff()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.team_members
    where auth_user_id = auth.uid() and is_active = true
  );
$$;

create or replace function public.portal_accessible_contact_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select pua.contact_id
  from public.portal_user_access pua
  join public.portal_users pu on pu.id = pua.portal_user_id
  where pu.auth_user_id = auth.uid()
    and pu.is_active = true
    and pua.contact_id is not null;
$$;

create or replace function public.portal_accessible_organization_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select pua.organization_id
  from public.portal_user_access pua
  join public.portal_users pu on pu.id = pua.portal_user_id
  where pu.auth_user_id = auth.uid()
    and pu.is_active = true
    and pua.organization_id is not null;
$$;

grant execute on function public.is_staff() to authenticated;
grant execute on function public.portal_accessible_contact_ids() to authenticated;
grant execute on function public.portal_accessible_organization_ids() to authenticated;

-- ---------------------------------------------------------------------
-- 3. Replace the wide-open policies on work_items / documents
-- ---------------------------------------------------------------------

drop policy if exists "Allow all on work_items" on public.work_items;
drop policy if exists "work_items_select_auth" on public.work_items;
drop policy if exists "work_items_insert_auth" on public.work_items;
drop policy if exists "work_items_update_auth" on public.work_items;
drop policy if exists "work_items_delete_auth" on public.work_items;

create policy "work_items_select_scoped" on public.work_items
  for select
  using (
    public.is_staff()
    or contact_id in (select public.portal_accessible_contact_ids())
    or organization_id in (select public.portal_accessible_organization_ids())
  );

create policy "work_items_write_staff_only" on public.work_items
  for all
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists "Allow all on documents" on public.documents;

create policy "documents_select_scoped" on public.documents
  for select
  using (
    public.is_staff()
    or contact_id in (select public.portal_accessible_contact_ids())
    or organization_id in (select public.portal_accessible_organization_ids())
  );

-- Staff can write anything. Portal clients may only insert a document
-- against an entity they can already see, and only when they mark it as
-- their own upload (matches the uploaded_by_role convention already used
-- by the upload routes).
create policy "documents_insert_staff_or_own_upload" on public.documents
  for insert
  with check (
    public.is_staff()
    or (
      uploaded_by_role = 'client'
      and (
        contact_id in (select public.portal_accessible_contact_ids())
        or organization_id in (select public.portal_accessible_organization_ids())
      )
    )
  );

create policy "documents_update_delete_staff_only" on public.documents
  for update
  using (public.is_staff())
  with check (public.is_staff());

create policy "documents_delete_staff_only" on public.documents
  for delete
  using (public.is_staff());

-- ---------------------------------------------------------------------
-- 4. portal_task_comments -- scope by joining through work_items
-- ---------------------------------------------------------------------

drop policy if exists "zz_deny_all_anon_auth__portal_task_comments" on public.portal_task_comments;

create policy "portal_task_comments_select_scoped" on public.portal_task_comments
  for select
  using (
    public.is_staff()
    or exists (
      select 1 from public.work_items wi
      where wi.id = portal_task_comments.work_item_id
        and (
          wi.contact_id in (select public.portal_accessible_contact_ids())
          or wi.organization_id in (select public.portal_accessible_organization_ids())
        )
    )
  );

create policy "portal_task_comments_insert_scoped" on public.portal_task_comments
  for insert
  with check (
    public.is_staff()
    or exists (
      select 1 from public.work_items wi
      where wi.id = portal_task_comments.work_item_id
        and (
          wi.contact_id in (select public.portal_accessible_contact_ids())
          or wi.organization_id in (select public.portal_accessible_organization_ids())
        )
    )
  );

-- ---------------------------------------------------------------------
-- 5. portal_messages
-- ---------------------------------------------------------------------

create policy "portal_messages_select_scoped" on public.portal_messages
  for select
  using (
    public.is_staff()
    or contact_id in (select public.portal_accessible_contact_ids())
    or organization_id in (select public.portal_accessible_organization_ids())
  );

create policy "portal_messages_insert_scoped" on public.portal_messages
  for insert
  with check (
    public.is_staff()
    or contact_id in (select public.portal_accessible_contact_ids())
    or organization_id in (select public.portal_accessible_organization_ids())
  );

-- ---------------------------------------------------------------------
-- 6. Lock down portal_users / portal_user_access themselves
-- ---------------------------------------------------------------------

create policy "portal_users_self_or_staff" on public.portal_users
  for select
  using (public.is_staff() or auth_user_id = auth.uid());

create policy "portal_users_staff_manage" on public.portal_users
  for all
  using (public.is_staff())
  with check (public.is_staff());

create policy "portal_user_access_self_or_staff" on public.portal_user_access
  for select
  using (
    public.is_staff()
    or portal_user_id in (
      select id from public.portal_users where auth_user_id = auth.uid()
    )
  );

create policy "portal_user_access_staff_manage" on public.portal_user_access
  for all
  using (public.is_staff())
  with check (public.is_staff());
