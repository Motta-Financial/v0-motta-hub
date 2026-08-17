-- 399: require is_staff() on every permissive RLS policy, so a client-portal
-- login (or no login at all) stops being able to read and write the firm's
-- operational tables.
--
-- ═══ WHY — measured against prod on 2026-08-17 ═══════════════════════
--
-- Two separate holes, one shared cause: 150 policies whose USING / WITH
-- CHECK clause is the literal `true`.
--
-- (1) A LOGGED-IN PORTAL USER could read 81 of 181 tables, 73 of them in
--     full. Simulated with a real portal_users JWT (role=authenticated,
--     sub=their auth uid), which is exactly how PostgREST evaluates a
--     portal session. The anon key ships in the browser bundle and a portal
--     user holds a genuine JWT, so this was reachable directly against
--     PostgREST — not only through the portal's own API routes, which do
--     scope their queries.
--
--     Worst of it, verified row-for-row:
--       zoom_connections              access_token + refresh_token (7)
--       ignition_connections          access_token + refresh_token (1)
--       zoom_transcripts              717   client call transcripts
--       zoom_recordings               843
--       karbon_timesheets           2,850   staff time and billing
--       ignition_payment_transactions 1,736 client payments
--       ignition_proposals          1,086   pricing
--       motta_recurring_revenue        68   firm financials
--       internal_clients            1,435   full client list
--       ignition_contacts           1,879
--       debriefs                      918   client meeting notes
--       tommy_award_ballots           436   internal peer feedback
--     …plus 61 more. Live OAuth refresh tokens are the sharp end: a portal
--     client could have called Zoom and Ignition directly as the firm.
--
--     Only contacts (1 of 1,475) and work_items (2 of 3,893) were scoped —
--     the two tables the portal UI reads. Everything else was never
--     revisited, so "lock down the schema" locked down the front door only.
--
-- (2) NO LOGIN AT ALL, and this is the worse one. `anon` holds
--     INSERT/UPDATE/DELETE grants on 179 tables (SELECT on only 6 —
--     scripts/359 revoked reads and stopped there). Paired with a
--     `{public}` + ALL + USING(true) policy, that is a live destructive path.
--
--     Measured with EXPLAIN on `delete from <table>` under role anon (plans
--     only, nothing executed): on 63 of the 110 tables in this sweep the plan
--     carries NO filter at all, meaning every row is deletable by anyone
--     holding the anon key — which ships in the browser bundle. Among them:
--       emails, invoices, invoice_line_items, payments, tax_returns,
--       tax_return_links, messages, meetings, projects, tasks, notes,
--       time_entries, debriefs, recurring_revenue, service_agreements
--
--     They could not READ those tables (no SELECT grant), which is why this
--     never surfaced as a leak — only as a way to lose the firm's billing and
--     tax records with one unauthenticated request.
--
--     NOTE on measurement, because it is easy to get wrong: a `delete ...
--     where false` probe returns success whether RLS blocked the rows or the
--     WHERE did, so it proves nothing. RLS filters rows silently on DELETE
--     rather than raising. Read the plan, or count affected rows — do not
--     infer from the absence of an error. An earlier pass of this
--     investigation called zoom_transcripts anon-deletable on exactly that
--     bad signal; it is not (already covered by a non-trivial policy).
--
-- ═══ THE FIX ═════════════════════════════════════════════════════════
--
-- Replace `true` with `is_staff()` on every permissive policy except an
-- explicit portal allowlist. is_staff() is SECURITY DEFINER over
-- team_members (auth_user_id = auth.uid() and is_active), so:
--
--   staff session   → true   (unchanged access — this is the important one)
--   portal session  → false  (verified against the live portal_users row)
--   anon            → false  (auth.uid() is null)
--
-- Because it is SECURITY DEFINER it does NOT recurse when the policy on
-- team_members itself starts calling it.
--
-- This is the pattern already proven on contacts
-- (`is_staff() OR id IN (select portal_accessible_contact_ids())`) — the
-- same idea applied to the 110 tables that never got it.
--
-- ═══ WHAT THIS DELIBERATELY DOES NOT TOUCH ═══════════════════════════
--
-- PORTAL_TABLES below are the 9 tables the portal genuinely reads through
-- a user session (enumerated from every .from() in app/api/client-portal/**
-- and lib/portal/**). Locking them to is_staff() would break the portal
-- itself, and each needs a *scoped* policy rather than a staff-only one —
-- that lands with the portal's own PR, where it can be tested against a
-- working portal. They stay as they are here; this migration is the part
-- that is safe to apply while the portal is off production.
--
-- Also untouched:
--   * service_role policies — trusted server-side, RLS is bypassed anyway.
--   * website_contact_submissions — the public contact form inserts there
--     with the ANON key (app/api/public/contact/route.ts via
--     lib/supabase/server.ts). It has no permissive policy in this sweep,
--     but it is named here so nobody "tidies" it into the list later and
--     silently breaks the website's contact form.
--
-- Anon's surplus write GRANTS are a separate cleanup. Not done here: the
-- policy change already blocks anon (is_staff() is false for it), and
-- revoking grants across 179 tables is a bigger blast radius than this
-- incident needs. Tracked as follow-up.
--
-- Idempotent: re-running re-applies is_staff() to anything that has drifted
-- back to `true`. Verify with the SELECT at the end — it must return zero
-- rows outside the allowlist.

begin;

do $$
declare
  -- Tables the client portal reads through a user session. Scoped
  -- individually in the portal PR; left alone here.
  portal_tables text[] := array[
    'contacts', 'documents', 'organizations', 'portal_messages',
    'portal_task_comments', 'portal_user_access', 'portal_users',
    'team_members', 'work_items'
  ];
  p record;
  n_using int := 0;
  n_check int := 0;
begin
  for p in
    select tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (qual = 'true' or with_check = 'true')
      -- service_role is trusted; RLS does not apply to it in practice.
      and roles::text not like '%service_role%'
      and not (tablename = any(portal_tables))
    order by tablename, policyname
  loop
    -- ALTER POLICY can set USING and WITH CHECK independently, and a policy
    -- only has WITH CHECK if its command writes. Set each only where the
    -- existing clause is the literal `true`, so a policy that already has a
    -- real predicate on one side keeps it.
    if p.qual = 'true' and p.with_check = 'true' then
      execute format(
        'alter policy %I on public.%I using (is_staff()) with check (is_staff())',
        p.policyname, p.tablename);
      n_using := n_using + 1;
      n_check := n_check + 1;
    elsif p.qual = 'true' then
      execute format(
        'alter policy %I on public.%I using (is_staff())',
        p.policyname, p.tablename);
      n_using := n_using + 1;
    else
      execute format(
        'alter policy %I on public.%I with check (is_staff())',
        p.policyname, p.tablename);
      n_check := n_check + 1;
    end if;
  end loop;

  raise notice '399: tightened % USING clause(s) and % WITH CHECK clause(s)', n_using, n_check;
end $$;

commit;

-- ── Verification ─────────────────────────────────────────────────────
-- Must return zero rows. Anything listed is still wide open to any
-- authenticated session, portal logins included.
select tablename, policyname, cmd, roles::text as roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and (qual = 'true' or with_check = 'true')
  and roles::text not like '%service_role%'
  and tablename not in (
    'contacts', 'documents', 'organizations', 'portal_messages',
    'portal_task_comments', 'portal_user_access', 'portal_users',
    'team_members', 'work_items'
  )
order by tablename, policyname;
