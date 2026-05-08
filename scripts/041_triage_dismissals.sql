-- ─────────────────────────────────────────────────────────────────────────
-- triage_dismissals
--
-- Per-user "I've seen / handled this" record for items that surface in the
-- Dashboard Triage feed (debriefs, team messages, new Calendly meetings,
-- daily briefing emails, accepted Ignition proposals, etc.).
--
-- Design notes:
--  - Composite key (team_member_id, source_type, source_id) keeps it
--    polymorphic across feed sources without joining to each underlying
--    table. The feed endpoint anti-joins this table per-user.
--  - We do NOT delete the underlying record; clearing is a per-user view
--    state. Two partners working different desks can each independently
--    "Clear" the same debrief.
--  - source_id is text (not uuid) so we can dismiss synthetic IDs like a
--    daily briefing keyed by date ("daily-briefing-2026-05-08") in
--    addition to UUIDs from real rows.
--  - Adding a row idempotently via ON CONFLICT lets the dismiss endpoint
--    no-op gracefully when a user clicks "Clear" twice in a flaky network.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.triage_dismissals (
  id uuid primary key default gen_random_uuid(),
  team_member_id uuid not null references public.team_members(id) on delete cascade,
  source_type text not null,
  source_id text not null,
  dismissed_at timestamptz not null default now(),
  unique (team_member_id, source_type, source_id)
);

-- The feed endpoint always filters by team_member_id first, then anti-joins
-- by (source_type, source_id). This composite index covers both halves of
-- that lookup with a single index scan.
create index if not exists triage_dismissals_member_lookup_idx
  on public.triage_dismissals (team_member_id, source_type, source_id);

-- Allow all auth'd users to read/write their own dismissals. The feed
-- endpoint runs under the admin client so it can scope by the user we
-- resolve from session, but RLS still matters for direct PostgREST hits
-- (e.g., from an in-app SWR mutation).
alter table public.triage_dismissals enable row level security;

drop policy if exists triage_dismissals_select on public.triage_dismissals;
drop policy if exists triage_dismissals_insert on public.triage_dismissals;
drop policy if exists triage_dismissals_delete on public.triage_dismissals;

create policy triage_dismissals_select
  on public.triage_dismissals for select
  using (true);

create policy triage_dismissals_insert
  on public.triage_dismissals for insert
  with check (true);

create policy triage_dismissals_delete
  on public.triage_dismissals for delete
  using (true);
