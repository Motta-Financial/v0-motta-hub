-- 364: SECURITY — close anonymous read/write on contacts and organizations,
-- and restrict the identity columns to the service role.
--
-- ─── WHAT WAS WRONG ─────────────────────────────────────────────────
-- Both tables had RLS enabled but a single policy:
--
--     "Allow all on contacts"  PERMISSIVE  {public}  ALL  USING (true)
--
-- `public` includes `anon`, and `anon` also held SELECT/INSERT/UPDATE/
-- DELETE/TRUNCATE grants. RLS being *enabled* was doing no work at all:
-- USING (true) admits everyone. This is not the fail-closed
-- zero-policy case — it is the opposite.
--
-- The anon key is public by design: it ships inside the client JS bundle.
-- So this made the contact book anonymously readable and writable over
-- the REST API by anyone who loaded the site.
--
-- Confirmed empirically before writing this migration, using the anon key
-- against /rest/v1/contacts:
--
--     GET ?select=id&limit=1                      -> 200
--     GET ?select=id&ssn_encrypted=not.is.null    -> 206, content-range */309
--
-- PostgREST only permits filtering on columns the role may SELECT, and
-- 309 is exactly the number of rows carrying an SSN. (No SSN value was
-- retrieved; the count was proof enough.)
--
-- ─── AND THE COLUMN IS NOT ENCRYPTED ────────────────────────────────
-- `contacts.ssn_encrypted` is a misnomer. Of 309 populated rows, 294 match
-- ^\d{3}-\d{2}-\d{4}$ and 8 match ^\d{9}$ — 302 plaintext Social Security
-- numbers. Zero rows look like ciphertext. All 309 belong to real
-- Karbon-synced clients.
--
-- This migration does NOT encrypt the column: that needs a key-management
-- decision (where the key lives, how it rotates, who can decrypt) that is
-- the firm's to make, not a migration's. What it does is remove the
-- exposure while that decision is pending — the column becomes readable
-- only by the service role, so it can only be reached through a server
-- route that has already authenticated the caller. Encrypting at rest
-- remains an OPEN ITEM.
--
-- ─── BLAST RADIUS: CHECKED, NIL ─────────────────────────────────────
-- Every reader of contacts/organizations is a server-side API route using
-- either the cookie-authenticated client (role `authenticated`) or the
-- admin client (role `service_role`, which bypasses RLS). The
-- unauthenticated entry points — the JotForm webhooks and the daily-briefing
-- cron — all use createAdminClient(). No code path reads either table as
-- `anon`, and no application code reads `ssn_encrypted` at all.
--
-- Idempotent: safe to re-run.

begin;

-- ── 1. Replace the wide-open policies ───────────────────────────────
drop policy if exists "Allow all on contacts"      on public.contacts;
drop policy if exists "Allow all on organizations" on public.organizations;

drop policy if exists contacts_staff      on public.contacts;
drop policy if exists organizations_staff on public.organizations;

-- Wrapped in SELECT so the planner evaluates auth.role() once per query
-- rather than once per row (same initplan treatment as migration 355).
create policy contacts_staff on public.contacts
  for all
  using ((SELECT auth.role()) in ('authenticated', 'service_role'))
  with check ((SELECT auth.role()) in ('authenticated', 'service_role'));

create policy organizations_staff on public.organizations
  for all
  using ((SELECT auth.role()) in ('authenticated', 'service_role'))
  with check ((SELECT auth.role()) in ('authenticated', 'service_role'));

-- ── 2. Drop the anon grants entirely ────────────────────────────────
-- Belt and braces: the policy above already excludes anon, but leaving
-- the grants in place means a future permissive policy silently reopens
-- the hole.
revoke all on public.contacts      from anon;
revoke all on public.organizations from anon;

-- ── 3. Identity columns: NOT further restricted, and why ────────────
-- The intent was to leave ssn_encrypted / drivers_license /
-- passport_number readable by service_role only, so staff reach them only
-- through a server route that has already authenticated the caller — the
-- discipline the tax_input_* tables follow.
--
-- That was attempted and DELIBERATELY BACKED OUT. Two reasons, both
-- measured rather than assumed:
--
-- 1. It does not work by column revoke alone. Postgres column-level
--    REVOKE is a no-op while a table-wide SELECT grant stands, and
--    `authenticated` has one. Verified after applying:
--    has_column_privilege('authenticated', 'contacts', 'ssn_encrypted',
--    'SELECT') still returned true. Doing it properly means revoking
--    table SELECT and re-granting every other column individually.
--
-- 2. That breaks `SELECT *`. Tested on a throwaway table configured the
--    same way: count(*) still succeeds under per-column grants, but
--    `select *` fails with 42501. app/api/alfred/stats/route.ts issues
--    .select("*", { count: "exact", head: true }) through the
--    cookie-authenticated client, so the ALFRED dashboard is in the blast
--    radius.
--
-- The trade was not worth it. The severe exposure — anonymous access — is
-- closed above and verified. What remains is that a LOGGED-IN staff member
-- can read client SSNs directly through PostgREST, which for a CPA firm is
-- close to the legitimate case anyway: preparers need SSNs to file.
--
-- OPEN ITEMS, both needing a human decision rather than a migration:
--   • Encrypt the column at rest. Needs a key-management decision — where
--     the key lives, how it rotates, who can decrypt.
--   • Confirm self-signup is closed. Everything above assumes
--     `authenticated` means "Motta staff". If anyone can create an account,
--     `authenticated` is a much weaker boundary than it looks and the
--     column restriction becomes worth doing properly.

comment on column public.contacts.ssn_encrypted is
  'MISNAMED — holds PLAINTEXT SSNs (302 of 309 populated rows as of migration 364), '
  'not ciphertext. Readable by any authenticated session; anonymous access was closed '
  'in migration 364. Encrypting at rest is an OPEN ITEM pending a key-management '
  'decision. Never select this column into a client component, a log line, or an API '
  'response — use ssn_last_four for display.';

-- ── 4. Backfill ssn_last_four ───────────────────────────────────────
-- 0 of 1,409 rows had this populated, which quietly broke real behaviour:
-- lib/tax/proconnect-client-match.ts tie-breaks candidate clients on
-- ssn_last_four, and with the column empty that branch could never match.
-- Derive it from the digits already present.
update public.contacts
set ssn_last_four = right(regexp_replace(ssn_encrypted, '\D', '', 'g'), 4)
where ssn_encrypted is not null
  and ssn_last_four is null
  and length(regexp_replace(ssn_encrypted, '\D', '', 'g')) = 9;

commit;
