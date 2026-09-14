-- 421: Durable record of a client approving their return for filing.
--
-- "Approve return" is a consent event, not a status. A boolean on a return
-- row cannot answer the question that matters later -- what exactly did
-- this person agree to, and when -- because the wording on screen changes
-- over time and a boolean does not remember which version it was.
--
-- So every approval stores the consent text VERBATIM as it was rendered,
-- plus who, when, and from where. Append-only: an approval is never
-- updated or deleted, and a withdrawal is a new row with action =
-- 'withdrawn'. This is the same mechanism the compliance/consent
-- conversation needs -- built once, usable for both.

create table if not exists public.return_approvals (
  id uuid primary key default gen_random_uuid(),

  -- Returns live in tax_returns; kept nullable + unconstrained on purpose
  -- so an approval can also be recorded against a return we only hold as a
  -- document, which is how the archive works today.
  tax_return_id uuid,
  document_id uuid,

  -- Who it belongs to. Exactly one, matching portal_messages' shape.
  contact_id uuid references public.contacts(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,

  -- Who clicked. A portal user, resolved at write time.
  portal_user_id uuid references public.portal_users(id) on delete set null,
  actor_name text not null,

  action text not null default 'approved' check (action in ('approved', 'withdrawn')),
  tax_year int,

  -- The consent wording EXACTLY as shown on screen. Not a key into a
  -- copy table -- the literal string, so a later wording change cannot
  -- rewrite what someone already agreed to.
  consent_text text not null,

  ip_address inet,
  user_agent text,

  created_at timestamptz not null default now(),

  constraint return_approvals_exactly_one_entity check (
    (contact_id is not null and organization_id is null)
    or (contact_id is null and organization_id is not null)
  )
);

create index if not exists return_approvals_contact_idx
  on public.return_approvals (contact_id, created_at desc);
create index if not exists return_approvals_org_idx
  on public.return_approvals (organization_id, created_at desc);

alter table public.return_approvals enable row level security;

-- Staff read everything; a portal user reads only their own entities'
-- approvals. Mirrors portal_messages_select_scoped (scripts/351).
drop policy if exists return_approvals_select_scoped on public.return_approvals;
create policy return_approvals_select_scoped on public.return_approvals
  for select
  using (
    public.is_staff()
    or contact_id in (select public.portal_accessible_contact_ids())
    or organization_id in (select public.portal_accessible_organization_ids())
  );

-- Insert only for your own entities. No update, no delete policy at all --
-- the table is append-only by construction, for staff too.
drop policy if exists return_approvals_insert_scoped on public.return_approvals;
create policy return_approvals_insert_scoped on public.return_approvals
  for insert
  with check (
    public.is_staff()
    or contact_id in (select public.portal_accessible_contact_ids())
    or organization_id in (select public.portal_accessible_organization_ids())
  );

comment on table public.return_approvals is
  'Append-only consent log for return approvals. Never UPDATE or DELETE a row; a withdrawal is a new row with action = withdrawn.';
