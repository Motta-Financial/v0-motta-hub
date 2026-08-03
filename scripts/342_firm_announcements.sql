-- Firm Announcements ("Broadcast")
-- Backing store for firm-wide announcements composed in /admin/broadcast.
-- Each row is a single announcement (TOPIC / ANNOUNCEMENT / ACTION ITEMS) that
-- is (1) emailed to the team from ALFRED ("BREAKING NEWS: <Topic>") and
-- (2) surfaced in every team member's Triage feed as a `broadcast` item.
--
-- The Triage feed reads this table directly and anti-joins each row against the
-- caller's `triage_dismissals` (source_type='broadcast', source_id=<id>), so
-- "Clear" hides the announcement for that user only — exactly like every other
-- triage source. No per-recipient fan-out rows are needed.

create table if not exists public.firm_announcements (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  announcement text not null,
  action_items text,
  created_by_id uuid references public.team_members (id) on delete set null,
  created_by_name text,
  email_attempted_count integer not null default 0,
  email_sent_count integer not null default 0,
  email_skipped_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists firm_announcements_created_at_idx
  on public.firm_announcements (created_at desc);

alter table public.firm_announcements enable row level security;

-- Mirror the permissive policy used by other internal Hub tables (messages,
-- debriefs, etc.). All server access goes through the service-role admin client
-- which bypasses RLS regardless; this policy keeps authenticated reads working
-- if the table is ever queried directly from the browser.
drop policy if exists "Allow all on firm_announcements" on public.firm_announcements;
create policy "Allow all on firm_announcements"
  on public.firm_announcements
  for all
  using (true)
  with check (true);
