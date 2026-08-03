# Motta Hub — Platform Specification

**Status:** current as of 2026-07-27 · `main` @ `ce972ef`
**Audience:** engineers and operators working on this repository.

This document describes what the Hub *is*: its architecture, trust model,
data model, integrations, and subsystems. For the endpoint-by-endpoint
contract, see **[API_REFERENCE.md](./API_REFERENCE.md)**.

---

## Table of contents

1. [What the Hub is](#1-what-the-hub-is)
2. [Architecture](#2-architecture)
3. [Trust and authorization model](#3-trust-and-authorization-model)
4. [Data model](#4-data-model)
5. [Integrations](#5-integrations)
6. [The ProConnect subsystem](#6-the-proconnect-subsystem)
7. [The Form 1040 engine](#7-the-form-1040-engine)
8. [ALFRED](#8-alfred)
9. [Scheduled work](#9-scheduled-work)
10. [Configuration](#10-configuration)
11. [Conventions](#11-conventions)
12. [Operational notes and known gaps](#12-operational-notes-and-known-gaps)

---

## 1. What the Hub is

The Motta Hub is the internal operating system for Motta Financial, a CPA
firm. It is a single Next.js application that consolidates the firm's
practice-management surface area:

- **Client and contact master data** — the firm's canonical record of who
  its clients are, reconciled across five external systems that each hold
  a partial, differently-keyed view.
- **Work management** — work items, tasks, projects, deals, and busy-season
  assignment, largely mirrored from Karbon.
- **Revenue** — proposals, invoices, payments, and recurring revenue,
  mirrored from Ignition and Stripe.
- **Meetings** — Calendly scheduling, Zoom recordings and transcripts, and
  the firm's own debrief write-ups, cross-linked to clients and work.
- **Tax production** — ProConnect Tax return sync, a structured 1040 intake
  and preview engine, and the client↔return linking that ties returns back
  to Hub clients.
- **ALFRED** — an AI assistant with read access to a governed subset of the
  database, served both in-Hub and at `alfred.motta.cpa`.
- **Firm culture and internal ops** — Tommy Awards, training library,
  announcements, resources, triage feed.

### The central problem it solves

Every external system keys clients differently: Karbon uses opaque
`ContactKey`/`OrganizationKey` strings, Ignition uses its own client IDs,
ProConnect uses Intuit client IDs, Calendly identifies people only by
invitee email, and Zoom by host and meeting ID. None of them agree, and
none of them are authoritative for all fields.

The Hub's job is to be the reconciliation layer. `contacts` and
`organizations` are the master records; `client_mapping`,
`tax_return_links`, `proconnect_profiles`, `ignition_clients`, and the
`master_client_mapping` view are the seams that stitch external identities
onto them. A large share of the codebase — matchers, auto-linkers, unlinked-
record queues, and admin reconciliation UI — exists to service that seam.

### Two-project split

The Hub (`hub.motta.cpa`) and the marketing site (`motta.cpa`) are separate
Vercel projects that **share one Supabase instance**. The separation is
deliberate: ALFRED is intended to be licensed to other firms, while
motta.cpa stays Motta-only. The contract between them is documented in
[public-api.md](./public-api.md); the Hub side is the `/api/public/*`
surface.

---

## 2. Architecture

### Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15.2.8, App Router, React 19 |
| Language | TypeScript 5 (strict) |
| Hosting | Vercel (`prj_VvPN85eN7oCBBRzcLD7YYokXbxo8`, project name `mottahub`) |
| Database | Supabase Postgres 17.6 (`gylupzxitoebhqjnvzuw`, "Motta Hub") |
| Auth | Supabase Auth (email/password) via `@supabase/ssr` cookies |
| Styling | Tailwind CSS 4, Radix primitives, `shadcn`-style components |
| Data fetching | SWR client-side; server components and route handlers server-side |
| AI | Vercel AI Gateway via the `ai` SDK (v6) — no provider SDK, no API key |
| Email | Resend |
| Payments | Stripe |
| Blob storage | Vercel Blob (`@vercel/blob`) |
| Validation | Zod 3 |

### Shape of the codebase

```
app/
  api/                299 route handlers  — the entire server surface
  <feature>/          105 pages          — the Hub UI, one dir per domain
  embed/              public iframe-able pages for motta.cpa
  legal/, docs/       publicly reachable (Zoom Marketplace review)
components/           shared UI + per-feature components
lib/
  supabase/           server / browser / middleware client factories
  auth/               requireAdmin, requireLeadership, role constants
  alfred/             allow-list, policy, auth guard, CORS, triage
  proconnect/         OAuth, API client, sync, data (Export/Import), catalog
  forms/              Form 1040 schema loader, evaluator, composer
  karbon/ calendly/ zoom/ ignition/ jotform/   per-integration logic
  ai/                 model registry + runtime config
scripts/              184 operational scripts (SQL migrations + Node tooling)
docs/                 this spec, API reference, integration guides, audits
```

### Deployment

Pushes to `main` auto-deploy to production. There is **no CI** — no GitHub
Actions workflows, and no ESLint configuration (`next lint` prompts for
setup). The only gate is `next build`, run locally.

> **Two Vercel projects share this repo.** `mottahub` is production and
> builds every commit successfully. `v0-motta-hub` is a stale project
> missing environment variables — **every** deployment on it shows ERROR,
> including commits that long predate current work. Red marks on
> `v0-motta-hub` are not build failures.

### Migrations

Migrations live in `scripts/*.sql` (128 files, numerically prefixed, applied
in order) rather than `supabase/migrations/` — that directory holds a single
file. They are applied via the Supabase MCP/API, not the Supabase CLI. New
migrations should continue the `scripts/NNN-description.sql` numbering.

---

## 3. Trust and authorization model

There are five distinct ways a request can be authorized. `middleware.ts`
decides which apply, then route handlers enforce the specifics.

### 3.1 Session auth (the default)

Every page and every `/api/*` route requires a Supabase session unless
explicitly exempted. Unauthenticated API requests get `401 {"error":
"Unauthorized"}`; unauthenticated page requests redirect to `/welcome`.

Middleware additionally enforces **platform-level deactivation**: if the
caller's `team_members` row has `is_active = false`, the session is signed
out and redirected to `/login?reason=deactivated`. A missing row is
permitted — that is a newly provisioned auth user who hasn't completed
onboarding.

### 3.2 Role tiers

Two overlapping tiers, both read from `team_members.role` (a controlled
vocabulary, case-sensitive):

| Tier | Roles | Helper |
|---|---|---|
| **Admin** | `Company`, `Partner`, `Admin` | `lib/auth/require-admin.ts` |
| **Leadership (PPD)** | `Partner`, `Principal`, `Director`, `Admin` | `lib/auth/require-leadership.ts` |

`Admin` appears in both so the back-end development lead can run operational
tooling without partner-level data visibility. Client components import the
same constants (`ADMIN_ROLES`, `LEADERSHIP_ROLES`, `isLeadershipRole`) to
hide controls; the server check is authoritative.

Only 21 of 299 routes gate on a role — 18 on `requireAdmin`, 3 on
`requireLeadership` (`/api/firm/hours`, `/api/proconnect/sync`, and the
ProConnect Import endpoint). Everything else treats any authenticated team
member as trusted. (`/api/alfred/chat` also imports `requireAdmin`, but uses
it inside a single tool rather than as a route gate.)

### 3.3 Cron auth

23 routes accept `Authorization: Bearer ${CRON_SECRET}`. Vercel Cron
supplies this automatically for paths in `vercel.json`. Several of these
routes also accept a logged-in admin, so they can be triggered manually from
the UI.

### 3.4 Webhook auth

Each inbound webhook verifies its own signature inside the handler;
middleware only ensures the request reaches it.

| Endpoint | Verification |
|---|---|
| `/api/karbon/webhooks` | HMAC vs `KARBON_WEBHOOK_SIGNING_KEY` |
| `/api/calendly/webhook` | HMAC vs per-subscription signing key |
| `/api/zoom/webhook` | `x-zm-signature` vs `ZOOM_WEBHOOK_SECRET_TOKEN` |
| `/api/zoom/s2s-webhook` | `x-zm-signature` vs `ZOOM_S2S_WEBHOOK_SECRET_TOKEN` |
| `/api/proconnect/webhooks` | `intuit-signature` HMAC-SHA256 vs `PROCONNECT_WEBHOOK_VERIFIER_TOKEN` |
| `/api/webhooks/stripe` | Stripe signature vs `STRIPE_WEBHOOK_SECRET` |
| `/api/jotform/webhook` | **Not signed.** Free-tier Jotform can't sign, so the handler requires `?token=` matching the form's `webhook_secret` in `jotform_forms`. |
| `/api/ignition/webhook/[event]` | Per-event handler validation |

### 3.5 Public and cross-origin surfaces

- **`/api/public/*`** — anonymous, for motta.cpa. Each route enforces its
  own CORS origin allow-list, honeypot, and IP rate limit. Alternatively
  callable server-to-server with `x-motta-public-secret`.
- **`/api/alfred/{data,schema,search,stats}`** — `x-alfred-secret` header
  **or** a Hub session, checked by `requireAlfredAuth()`.
- **`/api/alfred/{chat,conversations,whoami}`** — Hub session cookie **or**
  `Authorization: Bearer <token>`, resolved by `lib/alfred/resolve-user.ts`.
  CORS preflights pass through unauthenticated by necessity.
- **`/api/alfred/health`** — deliberately unauthenticated status probe.
  Returns reachability, env presence, and whether the ALFRED service-account
  row exists. Leaks no user data.
- **`/embed/*`, `/legal/*`, `/docs/*`, `/welcome`** — public pages. The
  legal and docs pages must stay reachable for Zoom Marketplace review.
- **`/zoom/embed`** — iframed inside the Zoom client; identifies the user
  via `zoomSdk.getAppContext()` rather than a Hub session, because Auth0
  sets `X-Frame-Options: DENY` on `/login`.

### 3.6 Row-level security

**All 165 public tables have RLS enabled.** 37 of them have zero policies,
which means they are reachable only by the service role — that is the
intended posture for integration mirrors and audit logs, not an oversight.

Two things are worth knowing:

- The Hub's own server code overwhelmingly uses the **service-role key**
  (`SUPABASE_SERVICE_ROLE_KEY`, referenced at 73 call sites), which bypasses
  RLS entirely. RLS is therefore a backstop against direct anon-key access,
  not the Hub's primary authorization mechanism. Authorization lives in
  route handlers.
- `contacts` and `organizations` previously carried an overly permissive
  legacy policy that RLS was not effectively constraining. Migration `364`
  replaced it with authenticated-only policies; anonymous reads were
  re-tested afterwards and are refused. Any new policy on a master-data
  table should be reviewed against that migration before it ships.

### 3.7 ALFRED is not privileged

The ALFRED service-account `team_members` row is deliberately **not**
special-cased in middleware. It is subject to the same `is_active` check and
the same redirect rules as any user. Privileged automation running as ALFRED
must use service-role calls inside a route handler, never an elevated
session.

---

## 4. Data model

165 tables and 22 views in `public`. Below they are grouped by domain, with
live row estimates where meaningful. Column counts hint at which tables are
wide mirrors of external payloads (`work_items` at 77 columns, `contacts` at
75) versus narrow join tables.

### 4.1 Master data

| Table | Rows | Notes |
|---|---|---|
| `contacts` | 1,409 | Master person record, 75 cols. Karbon-sourced plus Hub-native fields. |
| `organizations` | 727 | Master entity record, 74 cols. |
| `contact_organizations` | 95 | Person↔entity membership with role. |
| `client_groups` | 44 | Karbon client groups. |
| `client_group_members` | — | Group membership. |
| `client_mapping` | 1,965 | The cross-system identity seam. |
| `client_profile_summaries` | — | 63-col denormalized profile rollup. |
| `team_members` | 19 | Staff directory; drives auth, roles, assignment. |
| `referrals` | 360 | Referral source attribution. |

Views: `clients_unified`, `clients_with_profile`, `master_client_mapping`.

### 4.2 Work management

| Table | Rows | Notes |
|---|---|---|
| `work_items` | 3,695 | Karbon work items, 77 cols. The busiest table. |
| `work_item_assignees` | — | Many-to-many assignment. |
| `tasks` | 203 | Hub-native tasks (Karbon tasks live in `karbon_tasks`). |
| `work_status` | 142 | Karbon work statuses, editable in-Hub. |
| `work_types` / `work_templates` | 43 / 59 | Karbon taxonomy. |
| `projects` / `project_clients` / `project_systems` | 407 / 51 / — | Hub-native projects. |
| `deals` / `deal_work_items` | 135 / 145 | Pipeline. |
| `pipelines`, `pipeline_stages` | — | Configurable stages. |
| `busy_season_work_items` | — | 35-col seasonal assignment, with `busy_season_assignment_history`. |
| `bookkeeping_checklist_progress` | — | Per-work-item accounting checklist. |

Views: `work_items_enriched`, `projects_enriched`, `deals_enriched`.

### 4.3 Tax

| Table | Rows | Notes |
|---|---|---|
| `proconnect_clients` | 2,253 | Mirror of ProConnect clients. |
| `proconnect_engagements` | 908 | Mirror of returns/engagements. |
| `proconnect_return_snapshots` | — | Raw Export payloads per return. |
| `proconnect_return_field_cells` | 1,127 | Flattened `series/prefix/code/suffix` cells. |
| `proconnect_field_catalog` | — | The 67,810-row field catalog (**not yet loaded**). |
| `proconnect_import_jobs`, `proconnect_import_entry_results` | — | Import audit trail. |
| `proconnect_oauth_tokens` | 1 | Single-tenant Intuit token. |
| `proconnect_webhook_events` | 5,415 | Raw inbound webhook log. |
| `proconnect_sync_logs` | 78 · `proconnect_custom_statuses`, `proconnect_profiles`, `proconnect_export_raw` | Sync + config. |
| `tax_return_links` | 823 | Return↔Hub-client links. |
| `tax_returns` | — | Hub-native return records. |
| `tax_client_relationships`, `tax_client_relationship_signals` | — | Inferred household/entity relationships. |
| `tax_input_sets`, `tax_input_values`, `tax_input_field_defs` (79), `tax_input_documents` | — | Structured 1040 intake (document-driven). |
| `form_1040_line_entries` | — | Directly-entered 1040 line values, scoped to an intake set. Computed lines are never stored. |
| `form_1040_lines` (72), `form_1040_line_inputs` (72), `form_1040_proconnect_map` (72), `form_1040_constants` | — | The 1040 engine schema. |
| `tax_proconnect_client_link_log` | 198 | Auto-link audit. |

Views: `proconnect_engagements_enriched`, `proconnect_returns_with_data`,
`tax_return_links_enriched`, `tax_client_relationships_enriched`,
`form_1040_lines_with_map`.

### 4.4 Revenue

`ignition_proposals` (969), `ignition_proposal_services` (2,533),
`ignition_payments` (1,714), `ignition_invoices` (1,244),
`ignition_contacts` (1,866), `ignition_clients` (594),
`ignition_payment_transactions` (175), `ignition_disbursals` (52),
`ignition_deals` (51), `ignition_services` (345), `ignition_deal_stages` (9),
`ignition_connections` (1), `ignition_webhook_events` (55).

Hub-native: `invoices`, `invoice_line_items`, `payments`,
`payment_requests`, `service_agreements`, `services` (60),
`service_packages`, `service_lines`, `recurring_revenue`,
`motta_recurring_revenue` (68), `time_entries`.

Stripe: `stripe_customers`, `stripe_payments`.

Views: `ignition_proposals_enriched`, `unmatched_ignition_clients`,
`motta_recurring_revenue_by_client`.

### 4.5 Meetings

Calendly: `calendly_events` (228), `calendly_invitees` (228),
`calendly_event_types` (36), `calendly_connections` (5),
`calendly_event_clients` (49), `calendly_event_services`,
`calendly_event_work_items`, `calendly_event_comments`,
`calendly_event_type_colors`, `calendly_sync_log` (3,912),
`calendly_webhook_events`, `calendly_webhook_subscriptions`,
`calendly_alfred_triage_log`.

Zoom: `zoom_meetings` (200), `zoom_recordings` (290),
`zoom_transcripts` (252), `zoom_connections` (7),
`zoom_webhook_events` (6,193), `zoom_alfred_triage_log` (25,572 — the
largest table), `zoom_meeting_{clients,deals,projects,work_items}`,
`zoom_sync_log`.

Hub: `meetings` (465), `meeting_attendees`, `debriefs` (907),
`debrief_comments`, `meeting_notes_debriefs` (62 cols, currently empty).

Views: `hub_meetings_enriched`, `debriefs_full`, `debriefs_search`,
`debriefs_with_member`, `zoom_meetings_with_tag_counts`.

### 4.6 Intake and leads

`jotform_intake_submissions` (225, 65 cols),
`jotform_feedback_submissions` (44), `jotform_forms`,
`jotform_webhook_events`, `prospect_submissions` (12, 74 cols),
`leads`, `website_contact_submissions`, `bank_profiles`,
`transaction_patterns`.

### 4.7 Karbon mirrors

`karbon_timesheets` (2,603), `karbon_webhook_events` (71),
`karbon_webhook_subscriptions` (8), `karbon_notes`, `karbon_tasks`,
`karbon_invoices` (3), `karbon_raw_ingest`, `karbon_outbound_changes`,
`hub_merge_log`, `hub_merge_backup`. View: `karbon_sync_health`.

### 4.8 ALFRED and AI

`alfred_conversations` (6), `alfred_messages` (14), `alfred_projects`,
`alfred_project_knowledge`, `ai_configurations`, `ai_usage_log` (159),
`accuracy_metrics`, `learning_log`. Views: `alfred_meeting_transcripts`,
`alfred_resource_documents`.

### 4.9 Internal ops and culture

`sync_log` (9,699), `activity_log`, `notifications` (1,316),
`notification_preferences`, `integration_alerts`, `firm_settings`,
`firm_announcements`, `messages` + `message_{comments,reactions,edit_history}`,
`triage_dismissals`, `saved_views`, `dashboards`, `dashboard_widgets`,
`tags`, `notes`, `documents`, `emails`, `resource_documents`,
`training_videos`, `training_categories`, `user_feedback`,
`motta_alliance_issues`, `portal_task_comments`.

Tommy Awards: `tommy_award_ballots` (322), `tommy_award_points` (543),
`tommy_award_weeks` (149), `tommy_award_ballot_history` (51),
`tommy_award_yearly_totals` (25), `tommy_weekly_recaps`.

---

## 5. Integrations

Seven external systems, each with a different auth model and sync strategy.

| System | Auth | Ingress | Cadence |
|---|---|---|---|
| **Karbon** | Static `KARBON_BEARER_TOKEN` + `KARBON_ACCESS_KEY` | Poll + webhooks | every 15 min (30 min timesheets) |
| **Calendly** | OAuth 2 per user, refresh stored | Poll + webhooks | every 30 min |
| **Zoom** | OAuth 2 per user **and** account-wide S2S | Poll + webhooks | hourly sweeps, 05:30 recording sync |
| **Ignition** | OAuth 2, single connection | Poll + webhooks | every 15 min |
| **Jotform** | API key | Webhook (token-gated) | on submission |
| **ProConnect (Intuit)** | OAuth 2, single tenant | Poll + webhooks | daily 06:00 |
| **Stripe** | Secret key | Webhook | on event |

Supporting: **Resend** (transactional + broadcast email), **Vercel Blob**
(attachments), **Vercel AI Gateway** (all LLM calls), **Airtable**
(legacy migration source, read-only), **Browserbase** and **Parallel**
(lead-enrichment research).

### 5.1 Karbon — the practice-management spine

Karbon is the system of record for clients, work, and time. The Hub mirrors
it rather than replacing it. `/api/cron/karbon-sync` runs every 15 minutes
and fans out across contacts, organizations, work items, tasks, notes, and
work statuses; internal server-to-server calls in that chain carry
`x-internal-secret: ${CRON_SECRET}` so middleware admits them.

Writes flow **back** to Karbon for a limited set of operations (contact and
organization PATCH/PUT, work-item updates, task creation, notes) — these are
the routes under `/api/karbon/*` that expose non-GET methods.
`karbon_outbound_changes` tracks them.

Karbon's credentials are static tokens with no refresh. Credential failure
is detected and surfaced via `integration_alerts` and the
`karbon_sync_health` view; `/api/karbon/sync-health` exposes it.

### 5.2 Calendly

Per-user OAuth with stored refresh tokens (`calendly_connections`, 5 rows).
Events and invitees sync every 30 minutes and via webhooks. Invitees are
matched to Hub contacts by email (`lib/calendly-invitee-match.ts`) — the
only identifier Calendly provides. Matched events are linked to clients,
services, and work items through the `calendly_event_*` join tables.

### 5.3 Zoom

Two OAuth apps: a **per-user** app (`zoom_connections`, 7 rows) and an
**account-wide Server-to-Server** app used by
`/api/zoom/recordings/sync-account` to pull recordings for every account
user nightly. Recordings, transcripts, and AI Companion summaries are
ingested and cross-linked to meetings, clients, deals, projects, and work
items. `/api/zoom/meetings/generate-todos` derives action items from
transcripts.

The Hub is also a **Zoom Marketplace app** with a Surface (`/zoom/embed`),
which is why `/legal/*` and `/docs/*` must stay publicly reachable.

### 5.4 Ignition

Single-connection OAuth (`ignition_connections`). Proposals, services,
invoices, payments, disbursals, and deals sync every 15 minutes. Ignition
clients are matched to Hub clients through
`/api/ignition/clients/[id]/match`, with `unmatched_ignition_clients`
driving a reconciliation queue in `/admin/ignition`.

### 5.5 Jotform

Intake and feedback forms POST to `/api/jotform/webhook?token=…`. The
pipeline is: parse → enrich → match client → assign → notify → optionally
create a Karbon work item (`/api/jotform/intake/[id]/karbon-work-item`).
`lib/jotform/fee-estimate.ts` and `research-questions.ts` add LLM-derived
fields. Because free-tier Jotform cannot sign payloads, the per-form
`webhook_secret` in `jotform_forms` is the only authentication — treat it
as a bearer credential.

### 5.6 Stripe

Payment links and sessions for client payments, with the public,
token-addressed flow at `/api/public/pay/[token]/{session,status}` so a
client can pay without a Hub login. Webhooks land at `/api/webhooks/stripe`.
Note the env vars come in both plain (`STRIPE_SECRET_KEY`) and
`STRIPE_LIVE_*` variants.

---

## 6. The ProConnect subsystem

The most intricate part of the platform, and the newest. It integrates
Intuit ProConnect Tax (PTO) via the Open API.

### 6.1 OAuth

Single-tenant OAuth 2 against Intuit, with the token row in
`proconnect_oauth_tokens` (one row) and a realm ID identifying the firm's
ProConnect account. `lib/proconnect/oauth.ts` exposes `getAccessToken()`,
`forceTokenRefresh()`, `getTokenStatus()`, and `getRealmId()`.

Intuit's consent redirect (`/api/proconnect/oauth/callback`) arrives without
a Hub session cookie, so it is exempt from middleware auth; identity and
CSRF are instead enforced by an HMAC-signed `state` parameter
(`lib/proconnect/oauth-state.ts`). `/connect`, `/disconnect`, and `/launch`
all require an admin.

### 6.2 Client and engagement sync

`lib/proconnect/sync.ts` (1,304 lines) is the orchestrator:

- `runFullSync()` — the complete client + engagement pass.
- `runBulkSync()` — per-year bulk engagement fetch, which is what the
  nightly cron uses. The single-client fetch endpoint is unsupported by the
  API, so bulk-per-year is the only viable strategy at scale.
- `syncSingleClient()`, `refreshClientYearEngagements()`,
  `prefetchClientList()`, `deleteClient()` — targeted operations used by
  webhook handlers.
- `hydrateEngagementEfile()` / `hydrateStaleEfileStatuses()` — e-file status,
  which is the one field the bulk endpoints cannot supply. The engagement
  list returns `taxFiling.filings: []` on every row regardless of
  `include-efiles=true`; only `GET /v2/engagements/{id}` carries filings. So
  it costs one call per engagement and is scoped accordingly: webhooks
  hydrate the engagement that changed, and the nightly sync drains a queue
  of stale rows (never hydrated, or modified in PTO since `efile_synced_at`)
  bounded by `PROCONNECT_EFILE_HYDRATE_MAX` and `_BUDGET_MS`. Correspondingly,
  no list-derived upsert may write `efile_status` — that would blank the
  hydrated value nightly.
- `getSyncStats()` — what `/api/tax/proconnect-status` reports.

`PROCONNECT_SYNC_BUDGET_MS` bounds a sync run so it fits inside a Vercel
function's execution limit; the cron runs the bulk sync inline rather than
fanning out to a queue.

### 6.3 Webhooks

`/api/proconnect/webhooks` handles `Client`, `TaxReturn`, and
`TaxReturnWorkStatus` events, verified by HMAC-SHA256 `intuit-signature`.
Every payload is logged raw to `proconnect_webhook_events` (5,415 rows)
before processing.

`TaxReturn` and `TaxReturnWorkStatus` events both re-read the engagement's
e-file status from the single-engagement GET — the only near-real-time path
for it, since the list endpoint the nightly sync uses carries no filings.
Filings nest (`children[]` holds extensions) and each filing's status history
is append-only and unordered, so the status is chosen as: the highest-ranked
filing that has any status at all (own federal return > extension > state),
then that filing's latest entry by `statusUpdateTimestamp`. The chosen entry
is stored whole in `efile_latest` alongside the `efile_status` scalar, because
an `ACK_REJECTED` on an EXTENSION is not a rejected return and the scalar
alone cannot say which it was.

### 6.4 The field model — Export and Import

This is the part worth understanding before touching tax code.

A ProConnect return's data is addressed by a four-part key:

```
series  /  prefix  /  code  /  suffix
```

- **series** — a form or schedule group, versioned (`{series, version}`).
- **prefix / code / suffix** — locate a specific field within it.

Each addressed cell carries **sub-fields**, not a bare value:

| Sub-field | Meaning |
|---|---|
| `val` | the value |
| `desc` | description / label |
| `src` | source |
| `source` | (distinct from `src`) |
| `tsj` | Taxpayer / Spouse / Joint designator |
| `scope` | scope qualifier |
| `cityAbbrev` | city abbreviation for local returns |
| `amt` | amount, in catalog contexts |

**Export** (`exportReturnData()`) pulls a return's full `SeriesMap`, which
`flattenSeriesMap()` turns into flat `FlatCell` rows stored in
`proconnect_return_field_cells`. Raw payloads go to
`proconnect_return_snapshots` / `proconnect_export_raw`.

**Import** (`importSeries()`) writes values back. Imports are batched at
**`MAX_ENTRIES_PER_IMPORT = 500`** entries. Results come back per-entry, so
partial success is normal and must be handled: `ImportSeriesResult` and
`ImportEntryError` carry per-entry `ErrorDetail`s, persisted to
`proconnect_import_jobs` and `proconnect_import_entry_results`.

Import is the only genuinely destructive operation in the subsystem. It is
gated on `requireLeadership`.

### 6.5 The field catalog and pre-validation

`lib/proconnect/catalog.ts` validates entries **before** they are sent to
Intuit, against a catalog of every valid field and its constraints:

- `catalogIsLoaded()` — guard; everything below no-ops meaningfully without data.
- `lookupCodes()`, `knownSeries()` — catalog queries.
- `validateEntry()`, `validateBatches()` — return `ValidationProblem[]` with
  severity `blocking` or `warning`.

> **The catalog table is empty.** `proconnect_field_catalog` exists with the
> constraint parser written, but the 67,810 rows have not been loaded. Until
> `node scripts/358-load-proconnect-catalog.mjs <csv>` is run (it needs the
> service-role key), **pre-validation certifies nothing** — `catalogIsLoaded()`
> returns false and validation cannot reject a bad entry. This is the single
> most important caveat in the subsystem.

---

## 7. The Form 1040 engine

`lib/forms/form-1040.ts` (566 lines) is a small declarative tax engine that
turns structured intake into a previewable 1040 and, eventually, a
ProConnect Import.

### Schema, in the database

| Table | Role |
|---|---|
| `form_1040_lines` (72) | Line definitions: number, label, section, data type, computation |
| `form_1040_line_inputs` (72) | Which intake fields feed which line |
| `form_1040_proconnect_map` (72) | Line → `series/prefix/code/suffix` mapping |
| `form_1040_constants` | Bracket tables and statutory constants, per year |
| `tax_input_field_defs` (79) | The intake field vocabulary |

`loadSchema()` reads and caches all of this; `clearSchemaCache()` resets it.

### Evaluation

`evalComputation()` and `evaluateComputedLines()` resolve computed lines
from inputs and constants. `renderForm1040()` produces the preview;
`getTaxOwedOrRefund()` extracts the bottom line; `getLinesBySection()` and
`getConstantNumber()` are presentation helpers.

`composeImportEntries()` turns evaluated line values into
`ComposedSeries`/`ImportEntry` structures ready for
`lib/proconnect/data.ts#importSeries` — the seam where the 1040 engine meets
ProConnect.

### Two entry paths

Both write into one `tax_input_sets` row, and neither calls Intuit.

| Path | Surface | For |
|---|---|---|
| **Document-driven** | `/tax/intake/[setId]` | Anything that arrives on a form — W-2, 1099-INT/DIV/R, Schedule A. Values are keyed per document and the return is derived from them by `lib/tax/intake/compute.ts`. |
| **Direct line entry** | `/tax/intake/[setId]/1040` | Lines with no document behind them — Schedule 1 totals, estimated payments, a prior-year overpayment applied forward. Values are keyed straight onto 1040 lines. |

Direct entry is evaluated by `lib/tax/intake/direct-lines.ts`, which is
**pure** — no Supabase client, no env, no I/O — so the browser and the API
route run the same code. Computed lines recalculate as the preparer types
and are recomputed server-side on save; they are never persisted, so a
stored value cannot drift from its operands. `scripts/verify-1040-direct-entry.ts`
pins the arithmetic (59 assertions, `npx tsx`).

Three classes of line are refused by direct entry: computed lines, the
`fs_*` filing-status booleans (filing status has one home,
`tax_input_sets.filing_status`), and `ssn`/`ein` lines — identifiers are
read from the client profile and masked, never re-keyed into a second
store.

### Verification gates

Two boolean flags in `form_1040_constants` — **`tax_brackets_verified`** and
**`itemized_constants_verified`** — gate the preview. Until a human has
checked the loaded bracket and itemized-deduction constants for the year and
flipped them, the preview **refuses to display tax or itemized deductions**.
This is intentional: an unverified bracket table producing a plausible-
looking number is worse than producing none.

### Coverage reality

Filing from the Hub is blocked less by code than by data. Of 937 clients,
**48 (5.1%)** have all eight fields required for a 1040 header. DOB coverage
is **6.2%**, and DOB drives the OBBBA §63(f) senior deduction — which has no
ProConnect input field, so it must be computed Hub-side.
`/api/tax/intake/profile-coverage` reports this.

---

## 8. ALFRED

An AI assistant over the firm's data, served in-Hub at `/alfred` and
cross-origin at `alfred.motta.cpa`.

### 8.1 Model routing

All LLM calls go through the **Vercel AI Gateway** — no provider SDK, no
API key. On Vercel, `VERCEL_OIDC_TOKEN` authenticates; locally,
`AI_GATEWAY_API_KEY` is the fallback.

`lib/ai/models.ts` is the mandatory registry. Call sites reference a **named
role** or the exported ALFRED chat allowlist, never a raw model string:

| Role | Current binding |
|---|---|
| `ALFRED_CHAT_MODEL` | `anthropic/claude-sonnet-4.6` |
| `MEETING_SUMMARY_MODEL` | `anthropic/claude-sonnet-4.6` |
| `QUESTION_RESEARCH_MODEL` | `anthropic/claude-sonnet-4.6` |
| `EMAIL_PROSE_MODEL` | `anthropic/claude-haiku-4.5` |
| `LEAD_ENRICHMENT_MODEL` / `RESEARCH_SUMMARY_MODEL` | `anthropic/claude-haiku-4.5` |
| `IMAGE_PROMPT_MODEL` | `openai/gpt-5.5-pro` |
| `IMAGE_GENERATION_MODEL` | `openai/gpt-image-2` |

Bumping a role rebinds every call site at once. `ALFRED_CHAT_MODELS` is the
only per-request chat model override allowlist; it accepts approved text models
from Anthropic and OpenAI via the AI Gateway and deliberately excludes image
models. Adding a raw `"anthropic/…"` or `"openai/…"` string anywhere else in the
repo defeats the purpose of the file. Runtime overrides live in `ai_configurations`
(`/api/admin/ai/config`); spend is logged to `ai_usage_log`
(`/api/admin/ai/usage`).

### 8.2 The table allow-list

`lib/alfred/allowed-tables.ts` is the single source of truth for what ALFRED
can read: **72 tables and views**, alphabetically ordered, `as const` so the
type is a string-literal union. Each entry carries `key_columns` hints that
are embedded in both the `/api/alfred/data` catalog response and the chat
system prompt — without them the model guesses column names and fails.

Adding a table means: add to `ALLOWED_TABLES`, add a `TABLE_SCHEMAS` entry
with columns verified against `information_schema.columns`, and optionally
extend `getSearchColumns()`.

Note that several entries are **views**, not tables —
`clients_unified`, `debriefs_full`, `master_client_mapping`,
`deals_enriched`, `projects_enriched`, `work_items_enriched`,
`proconnect_engagements_enriched`, `tax_return_links_enriched`,
`alfred_meeting_transcripts`, `alfred_resource_documents`,
`motta_recurring_revenue_by_client`. Exposing curated views rather than base
tables is the intended pattern for anything sensitive.

### 8.3 Tools

The chat route exposes 18 tools:

**Generic data access** — `queryDatabase`, `searchAcrossTables`,
`getDatabaseStats`
**Domain rollups** — `getWorkItemsSummary`, `getTeamWorkload`,
`getClientInfo`, `getUpcomingDeadlines`, `getRecentActivity`, `getServices`,
`getFinancialSummary`, `getDealPipeline`, `getProjects`, `findPerson`,
`getTommyAwardsLeaderboard`
**Caller-scoped** — `getMyWorkItems`, `getMyUpcomingDeadlines`
**Zoom actions** — `getZoomRecordingStatus`, `pullZoomRecordings`

### 8.4 The policy seam

`lib/alfred/policy.ts` is the one place audience permissions are decided.
`buildPolicy()` runs once per request and returns an object that filters the
tool map, narrows `queryDatabase`'s allowed tables, and appends an
audience-specific system-prompt suffix.

`Audience` is `"staff" | "client"`. **The `client` branch is deliberately
unimplemented** — it throws a recognizable error that the route surfaces as
a clean 403. That is a forcing function: turning on a client-facing UI
requires an explicit decision here, not an accident of configuration.

### 8.5 Triage

`calendly_alfred_triage_log` and `zoom_alfred_triage_log` (25,572 rows)
record ALFRED's automated passes over incoming meetings and recordings —
the classification layer behind `/api/triage/feed`.

---

## 9. Scheduled work

18 cron entries in `vercel.json`. All times UTC; the pairs at consecutive
hours are DST straddles for a fixed Eastern wall-clock time
(`lib/cron-eastern.ts` resolves which one should act).

| Schedule (UTC) | Path | Purpose |
|---|---|---|
| `*/15 * * * *` | `/api/cron/karbon-sync` | Karbon full sync |
| `*/15 * * * *` | `/api/cron/ignition-sync` | Ignition sync |
| `*/30 * * * *` | `/api/cron/karbon-timesheets-sync` | Timesheets |
| `*/30 * * * *` | `/api/cron/calendly-sync` | Calendly events |
| `0 * * * *` | `/api/cron/zoom-todo-sweep` | Derive to-dos from transcripts |
| `0 * * * *` | `/api/cron/debrief-reminder` | Nudge missing debriefs |
| `15 * * * *` | `/api/cron/meeting-summary-ingest` | Ingest Zoom AI summaries |
| `20 * * * *` | `/api/cron/zoom-link-sweep` | Link recordings to entities |
| `30 5 * * *` | `/api/zoom/recordings/sync-account` | Account-wide S2S recording pull |
| `0 6 * * *` | `/api/cron/proconnect-sync` | ProConnect bulk sync |
| `0 12 * * 1-5` | `/api/cron/daily-briefing` | Weekday briefing email |
| `0 13 * * 1` | `/api/cron/meeting-summary` | Weekly meeting summary |
| `0 19,20 * * 4` | `/api/cron/tommy-ballot-reminder` | Thursday ballot nudge (DST pair) |
| `45 12,13 * * 5` | `/api/cron/tommy-weekly-recap` | Friday recap build (DST pair) |
| `0 16,17 * * 5` | `/api/cron/tommy-recap-send` | Friday recap send (DST pair) |

Not on a schedule but cron-authenticated: `/api/cron/tommy-podium-image`,
`/api/cron/tommy-recap-pdf`, `/api/meetings/sync`,
`/api/zoom/recordings/backfill`, `/api/karbon/sync-tenant-config`.

Every run writes to `sync_log` (9,699 rows) or a per-integration log table.

---

## 10. Configuration

76 environment variables. Grouped by subsystem; the count in parentheses is
how many call sites reference it, which is a rough proxy for how load-bearing
it is.

### Core

| Variable | Notes |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` (73) | Bypasses RLS. The Hub's primary DB credential. |
| `SUPABASE_URL` (57) / `NEXT_PUBLIC_SUPABASE_URL` (52) | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` (3) | **Ships in the client bundle.** Anything anon-readable is public. |
| `SUPABASE_SECRET_KEY` (17), `SUPABASE_JWT_SECRET` (5) | |
| `POSTGRES_URL` (21), `POSTGRES_URL_NON_POOLING` (36), `POSTGRES_PRISMA_URL` (4) | Direct SQL; non-pooling for migrations. |
| `SUPABASE_COOKIE_DOMAIN` | Shared session across `*.motta.cpa`. |
| `CRON_SECRET` (44) | Cron **and** internal server-to-server auth. |
| `NEXT_PUBLIC_APP_URL`, `APP_BASE_URL`, `VERCEL_URL`, `VERCEL_PROJECT_PRODUCTION_URL` | URL resolution. |

### Firm identity

`FIRM_NAME`, `FIRM_SHORT_NAME`, `FIRM_TIMEZONE`, `FIRM_HUB_URL`,
`FIRM_PUBLIC_SITE_URL`, `FIRM_SUPPORT_EMAIL`, `ASSISTANT_NAME`,
`ASSISTANT_EMAIL`, `MOTTA_SITE_URL`. These are being migrated into the
`firm_settings` table (`lib/firm-settings.ts` is the typed cached accessor)
so they are editable without a redeploy.

### Integrations

- **Karbon** — `KARBON_BEARER_TOKEN`, `KARBON_ACCESS_KEY`,
  `KARBON_WEBHOOK_SIGNING_KEY`, `KARBON_WEBHOOK_TARGET_URL`
- **Calendly** — `CALENDLY_CLIENT_ID`, `CALENDLY_CLIENT_SECRET`,
  `CALENDLY_REDIRECT_URI`, `CALENDLY_REDIRECT_URL`,
  `CALENDLY_WEBHOOK_SIGNING_KEY`
- **Zoom** — `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, `ZOOM_REDIRECT_URI`,
  `ZOOM_WEBHOOK_SECRET_TOKEN`, `ZOOM_S2S_{CLIENT_ID,CLIENT_SECRET,ACCOUNT_ID,WEBHOOK_SECRET_TOKEN}`,
  `ZOOM_MEETING_SDK_KEY`, `ZOOM_MEETING_SDK_SECRET`
- **Ignition** — `IGNITION_CLIENT_ID`, `IGNITION_CLIENT_SECRET`,
  `IGNITION_REDIRECT_URI`
- **ProConnect** — `PROCONNECT_CLIENT_ID`, `PROCONNECT_CLIENT_SECRET`,
  `PROCONNECT_REDIRECT_URI`, `PROCONNECT_REALM_ID`,
  `PROCONNECT_REFRESH_TOKEN`, `PROCONNECT_TAX_RETURNS_BASE_URL`,
  `PROCONNECT_WEBHOOK_VERIFIER_TOKEN`, `PROCONNECT_SYNC_BUDGET_MS`
- **Jotform** — `JOTFORM_API_KEY`, `JOTFORM_FORM_ID`,
  `JOTFORM_FEEDBACK_FORM_ID`
- **Stripe** — `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`,
  `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, plus
  `STRIPE_LIVE_*` variants
- **Email** — `RESEND_API_KEY`, `RESEND_FROM_EMAIL`,
  `WEBSITE_CONTACT_NOTIFY_TO`
- **AI** — `AI_GATEWAY_API_KEY` (local fallback only)
- **ALFRED** — `ALFRED_API_SECRET`, `ALFRED_PUBLIC_ORIGIN`
- **Public site** — `MOTTA_PUBLIC_SECRET`
- **Research** — `PARALLELWEB_PARALLEL_API_KEY`,
  `BROWSEBASE_BROWSERBASE_API_KEY`, `BROWSEBASE_BROWSERBASE_PROJECT_ID`
- **Legacy** — `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`, `AUTH0_BASE_URL`

---

## 11. Conventions

### Errors

Route handlers return `NextResponse.json({ error: string }, { status })`.
Middleware emits exactly `{"error": "Unauthorized"}` with `401`. ProConnect
code additionally uses a typed `Result<T>` union
(`{ ok: true, data } | { ok: false, error }`) rather than throwing, so
partial-failure paths are explicit.

### Auth in a route handler

```ts
const gate = await requireAdmin()          // or requireLeadership()
if (!gate.ok) return gate.response
// gate.userId, gate.email, gate.role, gate.teamMemberId available for auditing
```

### Supabase clients

- `lib/supabase/server.ts` — cookie-scoped, respects RLS. Use for
  user-scoped reads.
- service-role client — bypasses RLS. Use only where the route has already
  authorized the caller.
- `lib/supabase/middleware.ts` — session refresh only.

Never interpolate user-controlled values into a PostgREST filter string.
Middleware learned this the hard way: emails legally contain `,` and `)`
inside quoted local parts (RFC 5321), which broke an `.or()` filter and
silently logged users out. Use one `.eq()` per value so it is URL-encoded as
a whole token.

### Naming

- Route handler files are `app/api/<path>/route.ts`, exporting HTTP-method
  functions.
- Integration mirrors are prefixed by source (`karbon_*`, `zoom_*`,
  `ignition_*`, `proconnect_*`, `calendly_*`, `jotform_*`).
- Views that join a mirror to master data are suffixed `_enriched`.
- Migrations are `scripts/NNN-description.sql`, applied in numeric order.

### Audit trails

`lib/audit.ts` writes to `activity_log`; `/api/audit/[entityType]/[entityId]`
reads it back. Webhook payloads are logged raw before processing in every
integration, which is what makes replay (`/api/karbon/webhooks/events/retry`)
possible.

---

## 12. Operational notes and known gaps

Recorded so they are not rediscovered.

### Security

> **This repository is public.** Specific findings — affected columns, row
> counts, and unmitigated weaknesses — are deliberately **not** recorded
> here. They live in the internal security memo held outside the repo; ask
> the platform lead. A prior commit (`a955861`) redacted firm identifiers
> from committed docs for the same reason.
>
> What belongs here is the *shape* of the open work, so it isn't forgotten:
>
> 1. **At-rest encryption for taxpayer identifiers** is outstanding. The
>    column naming in this area is misleading — do not infer protection
>    from a column name; check the migration history.
> 2. **Column-level `REVOKE` does not work the way it looks like it does.**
>    A column `REVOKE` is a no-op under a table-wide grant, and doing it
>    properly breaks `select *`, which at least one endpoint issues. An
>    attempt was made and deliberately backed out rather than shipping SQL
>    that claims a protection it does not deliver. Read the migration
>    comment before retrying.
> 3. **Post-`364` policies assume `authenticated` implies staff.** Whether
>    that assumption holds is a Supabase project-level setting, not
>    something this codebase controls. Verify it directly.
> 4. **Some inbound integration credentials are single-factor** — a shared
>    token is the only thing standing between a caller and a write path.
>    Treat every value in §10 as a secret with a rotation owner.

### Data quality

5. **1040 profile coverage is 5.1%** (48/937 clients with a complete
   header). DOB at 6.2% is the expensive gap.
6. **The ProConnect field catalog is empty** — see §6.5. Pre-validation is
   inert until it is loaded.
7. **`tax_brackets_verified` / `itemized_constants_verified` are unset**, so
   the 1040 preview withholds tax and itemized deductions by design.

### Process

8. **No CI and no lint config.** `next build` run locally is the only gate.
   Adding a GitHub Actions workflow that runs `tsc --noEmit` and `next build`
   would catch what currently reaches production unchecked.
9. **Production was historically pinned to an unmerged branch.** A build
   from `debrief-management-tool` was manually promoted, so `main` was *not*
   what production served. Any merge to `main` would therefore have
   superseded it — as one did, temporarily reverting two commits of debrief
   soft-delete work. The workflow fix (always deploy from `main`) matters
   more than that single instance.
10. **`meeting_notes_debriefs` (62 columns) and `tax_input_values` are
    empty**, and `karbon_invoices` holds 3 rows against Ignition's 1,244 —
    these are either abandoned or not yet cut over. Worth an explicit
    decision before they accrete dependencies.

---

*Maintenance: this document describes structure, not a snapshot in time.
When adding an integration, a table group, or an auth path, update the
relevant section here and the endpoint table in
[API_REFERENCE.md](./API_REFERENCE.md).*
