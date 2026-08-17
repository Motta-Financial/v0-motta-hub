-- 400: close the last table a portal login could read wholesale, and give the
-- portal's "Your Team" card a narrow aperture in its place.
--
-- ═══ WHY ═════════════════════════════════════════════════════════════
--
-- scripts/399 locked 144 permissive policies down to is_staff() but
-- deliberately skipped the 9 tables the client portal reads, because those
-- need SCOPED policies rather than staff-only ones and could not be tested
-- while the portal was off production.
--
-- Re-measured after 399, 8 of those 9 turned out to be already correct —
-- scripts/351 gave them real `is_staff() OR <portal scope>` predicates, and
-- scoped WITH CHECK on the INSERT paths so portal writes still work:
--
--   contacts              portal sees 1 of 1,475
--   organizations         portal sees 0 of 734
--   work_items            portal sees 2 of 3,893
--   documents             scoped by contact_id, insert gated on
--                         uploaded_by_role = 'client'
--   portal_users          own row only (auth_user_id = auth.uid())
--   portal_user_access    own grants only
--   portal_messages       scoped by contact_id
--   portal_task_comments  scoped through work_items
--
-- team_members was the exception, and it was wide open: a single
-- `ALL / USING (true)` policy, so a portal session could read AND WRITE all
-- 23 rows. The columns are the problem as much as the rows —
--
--   email, phone_number, mobile_number, auth_user_id, karbon_user_key,
--   karbon_url, manager_id, start_date, department, role, is_service_account
--
-- none of which belongs to a client.
--
-- ═══ WHY A VIEW AND NOT A POLICY ═════════════════════════════════════
--
-- RLS filters ROWS, not COLUMNS. There is no policy that says "a portal user
-- may see a staff member's name but not their auth_user_id". So the table
-- becomes staff-only and the portal reads a view that selects only the
-- columns its one caller actually renders.
--
-- The view is deliberately NOT security_invoker: it runs with the owner's
-- privileges, so it is unaffected by the staff-only policy underneath. That
-- is the entire point — the view IS the aperture, and its column list is the
-- access control. Making it security_invoker would re-apply the table's
-- policy and return nothing to the portal.
--
-- The portal reads team_members in exactly ONE place:
-- app/api/client-portal/me/route.ts, filtered to the client's own
-- client_manager_key / client_partner_key, for the "Your Team" card. This
-- migration is paired with pointing that query at the view.
--
-- ═══ ACCEPTED RESIDUAL — read this before assuming it is airtight ════
--
-- The view is granted to `authenticated`, and PostgREST is reachable with the
-- anon key plus any valid JWT. The route filters to the caller's own manager
-- and partner, but a portal user querying the VIEW directly can enumerate
-- every active staff member's name, title and work email — 23 rows.
--
-- That is a deliberate trade, not an oversight: those are business identities
-- the firm publishes anyway, and the alternative (per-client staff scoping)
-- needs a client→staff join that does not exist yet. What the view does
-- guarantee is that no portal session can reach auth_user_id, phone numbers,
-- manager_id, start_date or the Karbon keys, and that nobody outside staff
-- can WRITE the table at all. If per-client scoping is wanted later, add a
-- predicate here — the callers will not change.
--
-- Idempotent.

begin;

-- ── (A) team_members: staff-only, PLUS an own-row escape hatch ───────
--
-- A bare is_staff() here would have been a live outage, and it is worth
-- spelling out because the trap is not obvious.
--
-- is_staff() is `exists (select 1 from team_members where auth_user_id =
-- auth.uid() and is_active)`. A staff row whose auth_user_id has never been
-- linked therefore fails its own check. /api/auth/user (the login membership
-- gate) looks a user up by auth_user_id, falls back to email, and self-heals
-- the link — all through the SESSION client, so RLS applies. Under a bare
-- is_staff() the email fallback returns nothing, the route answers "not
-- registered as a Motta team member", and the link never gets written.
--
-- Measured on prod before writing this: 23 rows, 6 unlinked, **3 of them
-- active**. Those 3 would have been permanently locked out of the Hub, and
-- every future hire would hit the same wall on first sign-in.
--
-- So SELECT also matches the caller's own row by JWT email. That is strictly
-- their own row — a portal login's email does not appear in team_members, so
-- this grants a portal session nothing.
--
-- WRITES stay is_staff() only. Widening the write predicate to the same
-- own-row test would let anyone who can authenticate UPDATE their own
-- team_members row — including is_active and role — which is privilege
-- escalation. The linking UPDATE in /api/auth/user moves to the admin
-- client instead, which is what it always should have been: linking an
-- identity is a system operation, not a user one.
drop policy if exists "Allow all on team_members" on public.team_members;

create policy "team_members_select_staff_or_own"
  on public.team_members
  for select
  using (
    is_staff()
    -- Own row by verified JWT email, so first sign-in can find itself
    -- before auth_user_id exists. Never widen this to writes.
    or (
      auth.uid() is not null
      and email is not null
      and lower(email) = lower(auth.jwt() ->> 'email')
    )
  );

create policy "team_members_write_staff_only"
  on public.team_members
  for all
  using (is_staff())
  with check (is_staff());

-- ── (B) the narrow aperture ──────────────────────────────────────────
drop view if exists public.portal_team_directory;

create view public.portal_team_directory
-- NOT security_invoker: see the header. The column list is the access
-- control, and the view must bypass the staff-only policy above.
with (security_invoker = false) as
select
  tm.karbon_user_key,
  tm.first_name,
  tm.last_name,
  tm.full_name,
  tm.title,
  tm.role,
  tm.email,
  tm.avatar_url
from public.team_members tm
where tm.is_active = true
  -- Integration/bot rows are not people and must never render on a
  -- client-facing team card.
  and coalesce(tm.is_service_account, false) = false;

comment on view public.portal_team_directory is
  'Client-safe projection of team_members for the portal''s "Your Team" card. '
  'Only the columns app/api/client-portal/me/route.ts renders; excludes '
  'auth_user_id, phone numbers, manager_id, start_date and Karbon keys. '
  'Deliberately NOT security_invoker — team_members itself is staff-only '
  '(scripts/399, 400) and this view is the controlled aperture past it. '
  'Read-only by construction: a view over one table with a WHERE clause is '
  'not auto-updatable through these grants because none are granted.';

-- SELECT only, and never to anon — scripts/359 revoked anon view reads and
-- that stays true here.
revoke all on public.portal_team_directory from anon;
grant select on public.portal_team_directory to authenticated;

commit;

-- ── Verification ─────────────────────────────────────────────────────
-- 1. No permissive policy left on team_members.
select tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'team_members';

-- 2. The view exposes only the safe columns.
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'portal_team_directory'
order by ordinal_position;

-- 3. anon must hold no grant on the view.
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'portal_team_directory'
order by grantee, privilege_type;
