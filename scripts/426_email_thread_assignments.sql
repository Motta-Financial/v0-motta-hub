-- 426: Attach an Outlook email thread to a work item.
--
-- This is the piece Micaela actually asked for -- "a triage for all the
-- emails that we get from the clients so that everything is in one place",
-- with each email attachable to a specific active work item. Reading and
-- replying from Triage is useful; attaching a thread to the job it belongs
-- to is the part that replaces Karbon.
--
-- Keyed on the Graph conversationId ALONE, not per-mailbox. A conversation
-- id is stable across mailboxes in the same tenant, so when Micaela files a
-- thread under "2024 Individual Tax Return", Terry sees that too. Scoping
-- it per mailbox would mean the same email being filed twice under the
-- same project by two people who each think it is unassigned -- which is
-- the Karbon behaviour this is meant to replace, not reproduce.
--
-- Nothing here stores email CONTENT. The thread lives in Outlook; this is
-- only the pointer saying which job it belongs to. That keeps client mail
-- out of our database until there is a deliberate decision to put it
-- there, and means deleting a row loses nothing but the filing.

create table if not exists public.email_thread_assignments (
  id uuid primary key default gen_random_uuid(),

  -- Microsoft Graph conversationId. Text, not uuid: it is an opaque
  -- base64-ish token, not a GUID.
  conversation_id text not null unique,

  work_item_id uuid not null
    references public.work_items(id) on delete cascade,

  -- Who filed it, for the "assigned by Micaela 2 days ago" affordance and
  -- so a wrong filing has an owner to ask.
  assigned_by_id uuid references public.team_members(id) on delete set null,

  -- Denormalised from the work item at assignment time so the Triage feed
  -- can show the client without a second join, and so a thread filed
  -- against a work item that is later reassigned still shows who it was
  -- about at the time.
  contact_id uuid references public.contacts(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists email_thread_assignments_work_item_idx
  on public.email_thread_assignments (work_item_id);

alter table public.email_thread_assignments enable row level security;

-- Staff only. Portal clients hold `authenticated` sessions in this same
-- project, and which client emailed the firm about which job is not
-- something another client should be able to enumerate.
drop policy if exists email_thread_assignments_staff on public.email_thread_assignments;
create policy email_thread_assignments_staff on public.email_thread_assignments
  for all
  using (public.is_staff())
  with check (public.is_staff());

comment on table public.email_thread_assignments is
  'Maps a Graph conversationId to a work item. Firm-wide, not per-mailbox. Stores no email content -- the thread stays in Outlook.';
