-- 424: Put outlook_connections in the repo, and lock it down.
--
-- This table already exists in production -- it was created directly
-- against the database while the Outlook integration was being built, so
-- nothing here recorded its shape or its privileges. That is the same
-- drift the tax_documents table is already in: a fresh environment does
-- not have it, and nobody can review its protection by reading the repo.
--
-- This migration is written to be a no-op against production (every
-- statement is IF NOT EXISTS / idempotent) while being complete enough to
-- stand up the table from scratch elsewhere.
--
-- What it holds is mailbox credentials: a Graph access token and refresh
-- token per staff member, with Mail.Read, Mail.ReadWrite and Mail.Send.
-- Anyone who can read a row can read and send that person's email. So the
-- privileges below matter more than the columns.

create table if not exists public.outlook_connections (
  id uuid primary key default gen_random_uuid(),

  team_member_id uuid not null
    references public.team_members(id) on delete cascade,

  -- Identity as Graph reports it, not as team_members has it on file --
  -- someone can consent with a different account, and the address client
  -- mail is actually addressed to is the one that matters for matching.
  outlook_user_id text,
  outlook_email text,
  outlook_display_name text,

  access_token text,
  refresh_token text,
  token_type text,
  expires_at timestamptz,
  scope text,

  is_active boolean default true,
  sync_enabled boolean default true,
  last_synced_at timestamptz,
  last_sync_error text,

  webhook_subscribed boolean default false,
  webhook_subscription_id text,

  emails_synced_count integer default 0,
  events_synced_count integer default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One mailbox per staff member; reconnecting replaces in place rather than
-- accumulating dead tokens that a sync would keep trying.
create unique index if not exists outlook_connections_team_member_uniq
  on public.outlook_connections (team_member_id);

-- ── Privileges ───────────────────────────────────────────────────────────
-- RLS with no policies plus no grants: service-role only. Deliberately
-- stricter than "staff can read" -- no browser session, staff or not, has
-- any reason to receive an access token, and the app never needs one
-- client-side.
--
-- `authenticated` is revoked EXPLICITLY rather than assumed. Portal clients
-- hold real `authenticated` sessions in this same project, so any table
-- reachable by that role is reachable by a client. A permission-denied
-- probe with the publishable key already returns 42501 today; this pins
-- that in place so a future blanket grant cannot quietly open it.

alter table public.outlook_connections enable row level security;

revoke all on public.outlook_connections from anon;
revoke all on public.outlook_connections from authenticated;

comment on table public.outlook_connections is
  'Per-staff-member Microsoft Graph tokens for Outlook mail/calendar sync. Service-role only: RLS enabled with NO policies and no grants to anon/authenticated. Never expose access_token or refresh_token through an API.';
comment on column public.outlook_connections.scope is
  'Scopes the STORED token actually carries. Adding a permission in Entra does not upgrade an existing token -- compare against the requested scopes to decide whether a reconnect is needed.';
