-- 359: Close an unauthenticated read of firm client data. APPLIED LIVE 2026-07-26.
--
-- ─── WHAT WAS WRONG ─────────────────────────────────────────────────
-- 20 views in `public` are owned by `postgres` and had `security_invoker`
-- unset. A view without security_invoker reads its base tables with the
-- VIEW OWNER's privileges, and `postgres` bypasses RLS — so every one of
-- these views served base-table rows regardless of the RLS policies
-- protecting those tables. `anon` held SELECT on all 20.
--
-- The Supabase anon key is public by design (it ships in the client
-- bundle), so this was an internet-reachable read of firm client data
-- requiring no authentication. Confirmed empirically, not inferred:
--
--   curl "$URL/rest/v1/deals_enriched?select=*&limit=1" \
--        -H "apikey: <anon>" -H "Authorization: Bearer <anon>"
--   → 200 with real contact_id / deal rows
--
-- Same for proconnect_engagements_enriched (real engagement + client ids)
-- and zoom_meetings_with_tag_counts. This is the Supabase advisor's
-- `security_definer_view` finding (22 views) — previously deferred in
-- docs/platform-efficiency-audit.md as something the tenant-scoped RLS
-- redesign would absorb. That deferral was wrong: it is an active leak,
-- not a multi-tenancy nicety.
--
-- Worth stating plainly, because it inverts the intuition: the BASE
-- tables were fine. RLS-enabled-with-zero-policies is fail-closed, and a
-- canary row proved anon could not read proconnect_field_catalog through
-- the table. Only the views bypassed it.
--
-- ─── TIMING ─────────────────────────────────────────────────────────
-- `proconnect_returns_with_data` currently returns [] only because the
-- snapshot tables are empty (Export is 403-blocked). The moment Intuit
-- provisions Export, that view would have served real return field data —
-- including the 963 SSN-typed fields — to anonymous callers. This had to
-- land before the catalog work makes Export useful.
--
-- ─── WHY REVOKE RATHER THAN security_invoker ────────────────────────
-- `ALTER VIEW ... SET (security_invoker = true)` is the more principled
-- fix, but it changes read semantics for EVERY caller: views whose base
-- tables have no authenticated policy (proconnect_returns_with_data over
-- proconnect_return_snapshots / _field_cells) would start returning zero
-- rows to any SSR authenticated client. Revoking `anon` closes the
-- internet hole while leaving authenticated and service_role behaviour
-- byte-identical, so it cannot silently break a read path.
--
-- Verified before applying: no browser-side code reads these views
-- directly (components fetch /api/* routes; the view names appear only in
-- comments), nothing uses NEXT_PUBLIC_SUPABASE_ANON_KEY server-side for
-- them, and /api/public/* touches only newsletter_subscribers,
-- website_contact_submissions and payment_requests.
--
-- Trivially reversible: GRANT SELECT ON <view> TO anon;
--
-- ─── STILL OPEN (deliberately not changed here) ─────────────────────
-- `authenticated` retains SELECT, and these views still bypass base-table
-- RLS for that role — so any signed-in account can read across all firm
-- data through them. Lower severity (staff are trusted on a firm-internal
-- tool) but it is the same mechanism, and it is what the tenant-scoped
-- RLS redesign must actually fix. Do not treat this migration as closing
-- the SECURITY DEFINER view issue in general.

REVOKE SELECT ON public.clients_unified                     FROM anon;
REVOKE SELECT ON public.clients_with_profile                FROM anon;
REVOKE SELECT ON public.deals_enriched                      FROM anon;
REVOKE SELECT ON public.debriefs_full                       FROM anon;
REVOKE SELECT ON public.debriefs_search                      FROM anon;
REVOKE SELECT ON public.debriefs_with_member                FROM anon;
REVOKE SELECT ON public.form_1040_lines_with_map            FROM anon;
REVOKE SELECT ON public.hub_meetings_enriched               FROM anon;
REVOKE SELECT ON public.ignition_proposals_enriched         FROM anon;
REVOKE SELECT ON public.karbon_sync_health                  FROM anon;
REVOKE SELECT ON public.master_client_mapping               FROM anon;
REVOKE SELECT ON public.motta_recurring_revenue_by_client    FROM anon;
REVOKE SELECT ON public.proconnect_engagements_enriched      FROM anon;
REVOKE SELECT ON public.proconnect_returns_with_data         FROM anon;
REVOKE SELECT ON public.projects_enriched                    FROM anon;
REVOKE SELECT ON public.tax_client_relationships_enriched     FROM anon;
REVOKE SELECT ON public.tax_return_links_enriched            FROM anon;
REVOKE SELECT ON public.unmatched_ignition_clients           FROM anon;
REVOKE SELECT ON public.work_items_enriched                  FROM anon;
REVOKE SELECT ON public.zoom_meetings_with_tag_counts        FROM anon;

-- NOTE: deliberately NOT running
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM anon;
-- It would also strip anon from future TABLES, and the public marketing
-- surface (newsletter_subscribers, website_contact_submissions,
-- payment_requests) may need anon reachability. Revisit deliberately.
-- Until then, any NEW view inherits anon SELECT — so re-run the audit
-- query below after adding one:
--
--   SELECT c.relname FROM pg_class c
--     JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public'
--    WHERE c.relkind IN ('v','m')
--      AND has_table_privilege('anon', c.oid, 'SELECT');
--
-- Post-change verification (all five returned 42501 permission denied):
--   deals_enriched, proconnect_engagements_enriched,
--   zoom_meetings_with_tag_counts, master_client_mapping,
--   proconnect_returns_with_data

-- ─── SEPARATE PRE-EXISTING BUG FOUND WHILE VERIFYING THIS ───────────
-- /api/public/stats returns 500 and has done since scripts/210. Two
-- independent causes, neither related to the revokes above:
--
--   1. scripts/210 did `REVOKE ALL ON FUNCTION
--      marketing.firm_stats_public_rpc() FROM PUBLIC` then granted
--      EXECUTE to `anon` only — but the route calls it with
--      createAdminClient() (service_role), which therefore had no
--      EXECUTE. Fixed live:
--        GRANT EXECUTE ON FUNCTION marketing.firm_stats_public_rpc()
--          TO service_role;
--
--   2. Still broken after that grant. PostgREST rejects the call
--      outright: PGRST106 "Invalid schema: marketing — only the
--      following schemas are exposed: public, graphql_public,
--      pgmq_public". The route's .schema("marketing").rpc(...) can never
--      resolve until `marketing` is exposed.
--
-- The function itself is healthy — called directly it returns
-- active_clients 1357, states_served 31. So the marketing site's
-- firm-stats block has simply never populated.
--
-- Two ways to fix (a decision, not applied here):
--   a) Add `marketing` to Exposed Schemas in the Supabase dashboard
--      (Settings > API). No code change; widens PostgREST's surface.
--   b) Add a thin SECURITY DEFINER wrapper in `public` that calls
--      marketing.firm_stats_public_rpc(), and drop `.schema("marketing")`
--      from the route. Keeps PostgREST's surface as-is. Preferred.
