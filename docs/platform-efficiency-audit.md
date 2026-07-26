# Platform Efficiency & Scalability Audit — 2026-07-26

A 15-agent audit swept every subsystem: all 292 API routes, middleware,
the sync libraries, 104 pages, 191 components, all SQL scripts, the live
Supabase advisors, pg_cron, and the deployed edge functions — plus a
full inventory of hardcoded firm-specific values for the licensing
roadmap. **240 efficiency findings** (26 critical / 75 high / 94 medium /
45 low) and **222 hardcoded values** were catalogued; the critical and
high tiers were then verified against the code and live data and fixed
in the same pass (71 fixes). This document is the durable record.

## ⚠️ Actions required (cannot be done from code)

1. ~~Confirm `APP_BASE_URL`~~ — **verified 2026-07-26: already correct.**
   `APP_BASE_URL=https://hub.motta.cpa` is set on Production, Preview,
   and Development. `FIRM_HUB_URL` is an optional alias that is *not*
   set and does *not* need to be — `APP_BASE_URL` is the env fallback
   and the `firm.hub_url` DB row takes precedence over both. **No env
   var action is required.**
2. **Consider rotating the Supabase service-role key.** It was embedded
   in plaintext in a pg_cron job command (`proconnect_token_refresh`,
   now unscheduled), i.e. visible to anything that could read
   `cron.job`. Exposure is limited (reading cron.job already requires
   elevated DB access) — flagging for a decision, not an emergency.
3. **Airtable — no action, deliberately.** Airtable has been sunsetted
   at the firm. The integration code is retained (future licensees may
   use Airtable) and both routes now read `AIRTABLE_API_KEY` from env,
   so the feature is inert until a key is configured. The PAT that was
   previously committed in source is still in git history: if the
   Airtable base is ever reactivated, revoke that token first.

## Vercel topology (verified 2026-07-26)

This GitHub repo is connected to **two** Vercel projects:

| Project | Domains | State |
| --- | --- | --- |
| `mottahub` | **hub.motta.cpa** + previews | The live Hub. Every branch push builds green. |
| `v0-motta-hub` | `*.vercel.app` only | **Every build fails** — no Stripe (and per earlier notes no `SUPABASE_URL`) env vars. Nothing points at it. |
| `mottawebsite` | motta.cpa, www.motta.cpa, mottafinancial.com, www.mottafinancial.com | Marketing site — a *separate* codebase. |

Two consequences worth knowing:

- The Hub and the marketing site are different Vercel projects with
  different route tables, so a Hub deep-link sent to motta.cpa 404s.
  That is what made `NEXT_PUBLIC_APP_URL` dangerous as a Hub-URL source
  (see the correction below).
- `v0-motta-hub` produces a failed deployment on every push to this
  repo. It's harmless (no traffic) but it makes real build failures hard
  to spot — worth either deleting the project or giving it the env vars.

### Correction: the wrong-host hazard was latent, not active

An earlier revision of this document stated that `NEXT_PUBLIC_APP_URL`
points at the marketing site *in production*. **That was wrong as a
statement of current fact** — on `mottahub` it is set to
`https://hub.motta.cpa` (Production + Development; no Preview value).
So the ~15 call sites that read `NEXT_PUBLIC_APP_URL || "https://hub.motta.cpa"`
were resolving to the correct host, and no live traffic was misrouted.

The hazard was real *historically*, and severe when it fired —
`app/api/karbon/sync/route.ts` documents the incident: the variable was
pointed at `https://motta.cpa`, every internal fan-out call 404'd, and
the Karbon drift/full sync silently broke for weeks (work items,
contacts, and orgs went stale). That is why the defensive
"never use `NEXT_PUBLIC_APP_URL`" comments are scattered through the
OAuth and webhook routes.

Routing Hub-URL resolution through `firm_settings` is therefore a
**durability fix, not an outage fix**: `NEXT_PUBLIC_APP_URL` is a
plausible thing for someone to point at the firm's marketing domain, it
is `NEXT_PUBLIC_` (inlined into client bundles at build time), and it
has no Preview value — so it should not be the source of truth for
server-side OAuth redirects and webhook registration regardless of what
it happens to hold today.

Production on `mottahub` is currently a **manually promoted deployment
from the `debrief-management-tool` branch**, not `main` — so merging
this branch to `main` will not by itself go live; it needs a promote.

## What was silently wrong today

PostgREST caps every response at 1,000 rows regardless of `.limit()`.
Live counts at audit time: `work_items` 3,699 · `ignition_proposal_services`
2,537 · `proconnect_clients` 2,253 · `ignition_payments` 1,713 ·
`contacts` 1,409. Everything that fetched a whole table and aggregated
in JS was already reporting wrong numbers:

- **Tax relationship scanner** saw only ~45% of ProConnect clients
  (and would have read at most 1,000 of ~5,000 field cells per return).
- **Sales dashboard** KPIs, payouts roll-up, and service-line revenue.
- **Work-items counts** (per-client), project roll-ups, ALFRED's
  team-workload and financial-summary tools, firm/profile hours,
  client picker (~400 contacts invisible), and a dozen more stat cards.

All are now fed by `lib/supabase/fetch-all.ts` (`fetchAllPaged` +
`chunk` for long `.in()` lists) — promoted from the pattern
`/api/tax/overview` pioneered.

### Correctness bugs fixed alongside

- **Karbon timesheets incremental sync never imported mid-week entries**
  (it filtered `StartDate gt` the stored week *EndDate*; the table was
  empty). Now a trailing 21-day window over idempotent upserts.
- Webhook event retry route filtered on nonexistent columns
  (`status`/`error_message` vs `processing_status`/`processing_error`).
- Ignition proposal stats matched capitalized labels the sync never
  stores (`"Accepted"` vs `accepted`) — accepted/draft/lost counts were 0.
- Tax client context `.or()` could attach *any* contact that had a
  Karbon key; dashboard details selected nonexistent contact columns.
- ALFRED Zoom triage re-ran hourly on the same unmatched meetings
  forever (26,452 log rows against ~200 meetings) — terminal outcomes
  now stamp `alfred_triage_at` and the failure path skips re-triage.

## Security fixes

- **Committed Airtable PAT** removed (rotate it — see above).
- **`/api/karbon/webhooks/subscriptions` + `/events/retry`** were fully
  unauthenticated (middleware exempts the webhook prefix): anonymous
  callers could delete every Karbon webhook subscription or redirect
  deliveries (client PII) to an attacker URL. Now `requireAdmin`, and
  the target URL must match the resolved Hub target.
- **`/api/zoom/oauth/refresh`** returned live Zoom access tokens for any
  `connection_id`, unauthenticated. Now session-gated.
- **Zoom OAuth `state` was forgeable** (unsigned base64): a crafted
  state could graft attacker tokens onto any team member's row. Now
  HMAC-signed in `/authorize`, verified with `timingSafeEqual` in the
  callback.
- **`admin/ai/config` PATCH, `team-members/setup-auth` (plaintext temp
  passwords), `team-members/sync-auth-users`, `admin/unlinked-records/link`**
  — service-role mutations reachable by any signed-in user; now
  `requireAdmin`. `zoom/oauth/disconnect` now requires a session.
- **`proconnect-refresh-token` edge function** was callable by anyone
  (`verify_jwt` off, CORS `*`) — an attacker could churn the live Intuit
  token. Redeployed (v9) with an in-body service-role guard. The three
  superseded `proconnect-sync-*` edge functions were redeployed as 410
  stubs (repo sources retain guarded reference implementations).

## Live operational cleanup (applied 2026-07-26)

`scripts/356_pg_cron_cleanup.sql` documents the full details:

- **Every pg_cron → edge-function job was failing with OOM** at the
  pg_net enqueue — including a staged-backfill job firing **every 2
  minutes** whose one-time cleanup had been mis-scheduled as a *yearly*
  cron. The Karbon edge sync stack duplicated the (working) Vercel
  crons. All seven dead/racy jobs unscheduled.
- **`proconnect_token_refresh` raced the app's on-demand refresh** —
  Intuit rotates refresh tokens on use, so two independent refreshers
  can invalidate each other. A plausible root cause of past ProConnect
  disconnects. The app is now the single refresher.
- `cron.job_run_details` purged (281k rows, 163k failures) with a daily
  7-day retention job added.
- `scripts/355_rls_initplan_wrap.sql`: 11 RLS policies wrapped so
  `auth.role()` evaluates once per statement instead of per row
  (Supabase advisor, hottest on the proconnect_* tables).

## Firm-settings extraction (licensing roadmap — NOW tier done)

- `firm_settings` table (`scripts/354`, applied) + `lib/firm-settings.ts`
  (DB row → env → coded default, 5-min cache, sync accessor) +
  `/api/admin/firm-settings` (GET/PUT, admin-gated).
- ~25 load-bearing call sites migrated: CORS allowlist, email
  From/deep-links, internal-domain matcher, ProConnect/Zoom OAuth
  redirects, Karbon webhook target, Calendly webhook/OAuth registration,
  password-reset/invite URLs, notification links.
- **Wrong-host dependency removed:** ~15 sites resolved the Hub base URL
  as `NEXT_PUBLIC_APP_URL || "https://hub.motta.cpa"` — including
  `getAppBaseUrl()`, which backs Calendly webhook registration and
  Calendly/Ignition OAuth callbacks. That variable currently holds the
  correct Hub URL, so nothing was actively misrouted; it has previously
  been pointed at the marketing domain and caused a multi-week silent
  Karbon sync outage. Hub-URL resolution now excludes it entirely. See
  “Correction” under Vercel topology.

### Remaining (inventoried, not yet migrated)

- `integrations.karbon.tenant_base_url` — the Karbon deep-link base
  (`https://app2.karbonhq.com/<tenant>#`) is hardcoded in ~9 routes.
- `integrations.jotform.intake_form_id` / `feedback_form_id` — hardcoded
  in ~5 files.
- `firm.timezone` — `America/New_York` in cron windows/briefings (needs
  the THEN-tier scheduling redesign; Vercel crons are fixed UTC pairs).
- 121 display-only files (legal pages, footers, page titles) — cosmetic;
  batch-migrate when the licensing UI work starts.

## Deferred findings (verified but deliberately not fixed now)

Architectural changes needing their own passes (in rough priority):

1. **ProConnect webhook ack** (`/api/proconnect/webhooks`): processes
   every entity synchronously (Intuit export + retries) before acking,
   no idempotency — needs an events-table + fast-ack pattern like the
   Karbon receiver. (Calendly's side-effects were already moved to
   `after()` in this pass.)
2. **Karbon roster endpoints** (`/api/karbon/clients`, per-client page)
   rebuild the roster by live-fetching every Karbon work item per
   request (no cache); the per-client route self-fetches the full
   3,300-item table to render one client.
3. **Busy-season sync** self-fetches its own origin per work item
   (N+1 over HTTP, and unauthenticated self-calls).
4. **Zoom account-wide recording sync** — unbounded users × 36 windows ×
   20 pages sequential loop; needs cursoring/queueing.
5. **Message board** has no pagination (fetches every message + nested
   reactions/comments) — needs UI-coordinated pagination.
6. **Middleware** runs an uncached `team_members.is_active` query per
   authenticated request — deliberate (instant deactivation); a short
   TTL cache trades ~seconds of revocation lag for a big hot-path win.
7. **`contexts/karbon-work-items-context.tsx`** ships up to 5,000 work
   items to every browser session; clients-list downloads whole books.
8. **RLS posture for licensing** (THEN tier): 105 `USING (true)`
   policies, 22 SECURITY DEFINER views, and 172 tables exposed via
   pg_graphql to anon — all get resolved by the tenant-scoped RLS
   redesign; piecemeal fixes now would be churn.
9. 94 medium / 45 low findings (smaller variants of the classes above)
   remain catalogued in the audit data.

## Method note

Findings were generated by parallel subsystem auditors, then each
critical/high finding was re-verified against the actual code and live
table sizes before fixing; 13 were skipped on verification (already
fixed, wrong, or requiring contract/schema changes) — the skip reasons
are recorded in the fix-wave results. Build + typecheck verified.
