# Motta Hub — API Reference

**Status:** current as of 2026-07-27 · `main` @ `ce972ef`
**Base URL:** `https://hub.motta.cpa`
**Companion document:** [SPEC.md](./SPEC.md) — architecture, data model, subsystems.

299 route handlers. This document covers all of them, grouped by domain.

---

## Conventions

### Authentication

Every endpoint below carries an **Auth** column with one of:

| Value | Meaning |
|---|---|
| `session` | Supabase session cookie. The default. Any active team member. |
| `admin` | `requireAdmin()` — `team_members.role ∈ {Company, Partner, Admin}` |
| `leadership` | `requireLeadership()` — `role ∈ {Partner, Principal, Director, Admin}` |
| `cron` | `Authorization: Bearer ${CRON_SECRET}` (some also accept `admin`) |
| `internal` | `x-internal-secret: ${CRON_SECRET}` (server-to-server sync chain) |
| `signature` | Provider HMAC verified in-handler. No session. |
| `alfred-secret` | `x-alfred-secret: ${ALFRED_API_SECRET}` **or** session |
| `alfred-user` | Session cookie **or** `Authorization: Bearer <token>` |
| `public-cors` | Anonymous, origin-allowlisted **or** `x-motta-public-secret` |
| `none` | Deliberately unauthenticated |

Unauthenticated requests to a `session` endpoint return:

```json
{ "error": "Unauthorized" }   // 401
```

### Errors

All handlers return `{ "error": "<message>" }` with an appropriate status.
Common: `400` validation, `401` unauthenticated, `403` role/policy,
`404` not found, `409` conflict, `429` rate-limited (public routes),
`500` server, `503` misconfigured (missing env).

ProConnect internals use a typed `Result<T>` union — `{ ok: true, data }` or
`{ ok: false, error }` — rather than throwing, so partial failures surface
explicitly rather than as a 500.

### Query parameters

Collection `GET` endpoints broadly accept `limit`, `offset`, `search`, and
domain-specific filters (`year`, `status`, `clientId`, `assigneeId`,
`from`/`to`). Exact filters are defined per handler; check the route file
before relying on one.

---

## 1. Auth and profile

| Endpoint | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/auth/user` | GET | session | Current user + `team_members` row |
| `/api/auth/logout` | POST | session | Sign out |
| `/api/auth/forgot-password` | POST | none | Start password reset |
| `/api/auth/test-smtp` | GET, POST | admin | Verify Resend/SMTP config |
| `/auth/callback` | GET | none | Supabase auth code exchange |
| `/auth/confirm` | GET | none | Email confirmation |
| `/api/profile` | PUT | session | Update own profile |
| `/api/profile/password` | PUT | session | Change own password |
| `/api/profile/avatar` | POST | session | Upload avatar (Vercel Blob) |
| `/api/profile/hours` | GET | session | Own logged hours |
| `/api/profile/trophy-case` | GET | session | Own Tommy Award history |

## 2. Team members

| Endpoint | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/team-members` | GET | session | Staff directory |
| `/api/team-members/invite-user` | POST | admin | Invite + provision auth user |
| `/api/team-members/setup-auth` | GET, POST | admin | Attach auth account to a `team_members` row |
| `/api/team-members/sync-auth-users` | GET, POST | admin | Reconcile `auth.users` ↔ `team_members` |
| `/api/team-members/tax-return-counts` | GET | session | Per-preparer return counts |
| `/api/firm/hours` | GET | **leadership** | Firm-wide hours rollup |

## 3. Admin

| Endpoint | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/admin/ai/config` | GET, PATCH | admin | Runtime model overrides (`ai_configurations`) |
| `/api/admin/ai/usage` | GET | admin | LLM spend (`ai_usage_log`) |
| `/api/admin/firm-settings` | GET, PUT | admin | Editable firm config (`firm_settings`) |
| `/api/admin/master-client-mapping` | GET | session | The `master_client_mapping` view |
| `/api/admin/unlinked-records` | GET | session | Records with no master link |
| `/api/admin/unlinked-records/stats` | GET | session | Counts by source |
| `/api/admin/unlinked-records/link` | POST | admin | Attach a record to a master client |
| `/api/admin/referrals` | GET | session | Referral attribution report |
| `/api/audit/[entityType]/[entityId]` | GET | session | `activity_log` for one entity |

## 4. Clients, contacts, organizations

| Endpoint | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/clients` | GET | session | List clients |
| `/api/clients/search` | GET | session | Typeahead search |
| `/api/clients/[id]` | GET, PATCH | session | Read / update a client |
| `/api/clients/[id]/context` | GET | session | Aggregated 360° context |
| `/api/clients/[id]/profile` | GET | session | Profile summary |
| `/api/clients/[id]/notes` | GET, POST | session | Client notes |
| `/api/clients/[id]/sync` | POST | session | Force re-sync from sources |
| `/api/clients/create-and-link` | POST | session | Create master record + link externals |
| `/api/contacts/[id]` | GET | session | Read a contact |
| `/api/contacts/[id]/links` | GET, POST, DELETE | session | Cross-system identity links |
| `/api/contacts/[id]/links/candidates` | GET | session | Suggested match candidates |
| `/api/contacts/[id]/organizations` | POST, PATCH, DELETE | session | Entity membership |
| `/api/contacts-and-orgs/search` | GET | session | Combined search |
| `/api/search` | GET | session | Global cross-entity search |

## 5. Work, tasks, projects, deals

| Endpoint | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/work-items` | GET | session | Work items (Karbon mirror) |
| `/api/tasks` | GET, POST | session | Hub tasks |
| `/api/tasks/[id]` | GET, PATCH, DELETE | session | One task |
| `/api/tasks/reorder` | POST | session | Reorder within a list |
| `/api/projects` | GET, POST | session | Projects |
| `/api/projects/[id]` | GET, PATCH, DELETE | session | One project |
| `/api/projects/[id]/clients` | GET, POST | session | Project clients |
| `/api/projects/[id]/clients/[clientRowId]` | PATCH, DELETE | session | One project client |
| `/api/projects/[id]/systems` | POST | session | Attach a system |
| `/api/projects/[id]/systems/[systemId]` | PATCH, DELETE | session | One system |
| `/api/project-templates` | GET | session | Templates |
| `/api/project-types` | GET | session | Type vocabulary |
| `/api/deals` | GET, POST | session | Deals |
| `/api/deals/[id]` | GET, PATCH | session | One deal |
| `/api/deals/[id]/work-items` | POST, DELETE | session | Link work to a deal |
| `/api/busy-season` | GET, POST | session | Busy-season assignments |
| `/api/busy-season/[id]` | GET, PATCH, DELETE | session | One assignment |
| `/api/busy-season/sync` | POST | session | Rebuild from work items |
| `/api/accounting/bookkeeping-checklist/[workItemId]` | GET, PUT | session | Per-work-item checklist |
| `/api/accounting/bookkeeping-checklist/summary` | POST | session | Checklist rollup |
| `/api/departments/accounting/onboarding` | GET | session | Accounting onboarding view |

## 6. Tax

### 6.1 Clients and returns

| Endpoint | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/tax/clients` | GET | session | Tax client list |
| `/api/tax/clients/[clientId]` | GET | session | One tax client |
| `/api/tax/clients/[clientId]/context` | GET | session | Full tax context |
| `/api/tax/clients/[clientId]/relationships` | GET | session | Household / entity links |
| `/api/tax/overview` | GET | session | Season dashboard |
| `/api/tax/returns` | GET | session | Returns list |
| `/api/tax/search` | GET | session | Tax-scoped search |
| `/api/tax/projects` | GET | session | Tax projects |
| `/api/tax/projects/[id]` | GET, POST | session | One tax project |
| `/api/tax/projects/returns/[returnId]/link` | PATCH | session | Link a return to a project |
| `/api/tax/relationships` | GET, POST | session | Relationship records |
| `/api/tax/relationships/scan` | POST | session | Infer relationships from signals |
| `/api/tax/client-links` | GET, POST | session | Client↔return links |
| `/api/tax/client-links/auto-link` | POST | session | Bulk auto-link by heuristic |
| `/api/tax/proconnect-profiles` | GET, PATCH | session | ProConnect preparer profiles |
| `/api/tax/proconnect-profiles/auto-link` | POST | session | Auto-attach profiles |
| `/api/tax/proconnect-status` | GET | session | Sync health + token status |

### 6.2 Structured intake

| Endpoint | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/tax/intake` | GET, POST | session | Intake sets |
| `/api/tax/intake/[setId]` | GET, PATCH | session | One set + values |
| `/api/tax/intake/[setId]/documents` | POST, PUT, DELETE | session | Attached documents |
| `/api/tax/intake/[setId]/lines` | GET, PUT | session | Direct 1040 line entry (see below) |
| `/api/tax/intake/profile-coverage` | GET | session | 1040 header-field coverage report |

#### Direct line entry

`GET` returns the seeded line schema, saved entries, the evaluated form
(computed lines derived, not stored), cross-line warnings, and the
verification-gate state. `PUT` upserts entered values and returns the
re-evaluated form.

```
PUT  { entries: { "1a": 120000, "10": "3,000" }, filingStatus?: "mfj" }
→    { saved, rejected[], filingStatus, entries, evaluated, warnings[], savedAt }
```

Three classes of line are refused, each reported in `rejected[]` rather
than silently dropped:

- **Computed lines** (`1z`, `9`, `11`, `15`, `24`, `33`, `34`, `37`, …) —
  derived on every read from `form_1040_lines.computation`. Storing one
  would let it drift from its operands.
- **`fs_*` filing-status lines** — filing status lives on
  `tax_input_sets.filing_status`; use the `filingStatus` field.
- **`ssn` / `ein` lines** — identifiers are read from the client profile and
  masked, never re-keyed into a second store.

Values are parsed leniently: `"$1,234.56"` and `"(500)"` (a negative, as it
appears on most tax documents) are both accepted.

### 6.3 Form 1040

| Endpoint | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/forms/1040/[returnId]` | GET, POST | session | Render preview / persist line values |

`GET` returns the evaluated form. **Tax and itemized-deduction lines are
withheld** unless `tax_brackets_verified` and
`itemized_constants_verified` are set in `form_1040_constants` for the year
— see [SPEC.md §7](./SPEC.md#7-the-form-1040-engine).

## 7. ProConnect Tax (Intuit)

| Endpoint | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/proconnect/oauth/connect` | GET | admin | Begin Intuit consent |
| `/api/proconnect/oauth/callback` | GET | none¹ | Consent redirect |
| `/api/proconnect/oauth/disconnect` | GET, POST | admin | Revoke token |
| `/api/proconnect/oauth/launch` | GET | admin | Deep-link into ProConnect |
| `/api/proconnect/sync` | GET, POST | **leadership** or cron | Trigger client + engagement sync |
| `/api/cron/proconnect-sync` | GET, POST | cron | Nightly bulk sync (06:00 UTC) |
| `/api/proconnect/returns/[returnId]` | GET | session | Return metadata |
| `/api/proconnect/returns/[returnId]/data` | GET, POST | session | Export return data / refresh snapshot |
| `/api/proconnect/returns/[returnId]/import/[seriesId]` | POST | **leadership** | **Write** values back to Intuit |
| `/api/proconnect/returns/imports` | GET | session | Import job history |
| `/api/proconnect/webhooks` | GET, POST | signature | `Client`, `TaxReturn`, `TaxReturnWorkStatus` events |

¹ Exempt from middleware because Intuit's cross-domain redirect carries no
Hub cookie. Identity and CSRF are enforced by an HMAC-signed `state`
parameter. `/connect`, `/disconnect`, and `/launch` are **not** exempt.

### The Import endpoint

`POST /api/proconnect/returns/[returnId]/import/[seriesId]` is the only
destructive operation in the subsystem.

```
Request   { entries: ImportEntry[] }        // max 500 per call
Response  { ok, results: ImportSeriesResult[], errors: ImportEntryError[] }
```

Each entry addresses a cell by `series / prefix / code / suffix` and carries
sub-fields (`val`, `desc`, `src`, `source`, `tsj`, `scope`, `cityAbbrev`).
**Partial success is normal** — results and errors are per-entry, persisted
to `proconnect_import_jobs` and `proconnect_import_entry_results`.

> Pre-validation via `lib/proconnect/catalog.ts` runs first, but
> `proconnect_field_catalog` is **empty** — until the 67,810-row catalog is
> loaded, `catalogIsLoaded()` returns false and validation cannot reject a
> bad entry. Treat Intuit's response as the only real validation today.

## 8. Karbon

Read endpoints mirror Karbon; non-GET methods write **back** to Karbon and
record the change in `karbon_outbound_changes`.

| Endpoint | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/karbon/contacts` | GET | session | Contacts |
| `/api/karbon/contacts/[contactKey]` | GET, POST, PATCH, PUT | session | Read / **write** a contact |
| `/api/karbon/organizations` | GET | session | Organizations |
| `/api/karbon/organizations/[organizationKey]` | GET, PATCH, PUT | session | Read / **write** an organization |
| `/api/karbon/clients` | GET | session | Clients |
| `/api/karbon/clients/[clientKey]` | GET | session | One client |
| `/api/karbon/client-groups` | GET | session | Client groups |
| `/api/karbon/client-groups/[clientGroupKey]` | GET | session | One group |
| `/api/karbon/work-items` | GET | session | Work items |
| `/api/karbon/work-items/[workItemKey]` | GET, PATCH, PUT | session | Read / **write** a work item |
| `/api/karbon/work-items/[workItemKey]/tasks` | GET, POST | session | Work-item tasks |
| `/api/karbon/work-items/[workItemKey]/notes` | GET, POST | session | Work-item notes |
| `/api/karbon/tasks` | GET, POST | session | Tasks |
| `/api/karbon/tasks/[taskKey]` | GET, PATCH, PUT, DELETE | session | One task |
| `/api/karbon/notes` | GET, POST | session | Notes |
| `/api/karbon/invoices` | GET | session | Invoices |
| `/api/karbon/timesheets` | GET, POST | session | Timesheets |
| `/api/karbon/users` | GET | session | Karbon users |
| `/api/karbon/work-statuses` | GET, PATCH | session | Statuses |
| `/api/karbon/work-templates` | GET | session | Templates |
| `/api/karbon/sync` | GET | cron / internal | Full sync entrypoint |
| `/api/karbon/sync-fullnames` | GET, POST | session | Backfill display names |
| `/api/karbon/sync-tenant-config` | GET, POST | cron | Refresh tenant config |
| `/api/karbon/sync-health` | GET | session | Credential + sync health |
| `/api/karbon/webhooks` | GET, POST | signature | Inbound events |
| `/api/karbon/webhooks/subscriptions` | GET, POST, DELETE | admin | Manage subscriptions |
| `/api/karbon/webhooks/events/retry` | POST | admin | Replay a logged event |
| `/api/migrate/karbon-organizations` | GET | session | One-off org migration |

## 9. Calendly

| Endpoint | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/calendly/oauth/authorize` | GET | session | Begin OAuth |
| `/api/calendly/oauth/callback` | GET | none¹ | OAuth redirect |
| `/api/calendly/oauth/refresh` | POST | session | Force token refresh |
| `/api/calendly/oauth/disconnect` | POST | session | Revoke |
| `/api/calendly/connections` | GET, PATCH | session | Per-user connections |
| `/api/calendly/user` | GET | session | Calendly identity |
| `/api/calendly/organization` | GET, POST | session | Org settings |
| `/api/calendly/groups` | GET | session | Groups |
| `/api/calendly/event-types` | GET | session | Event types |
| `/api/calendly/event-type-colors` | GET, PATCH | session | UI colors |
| `/api/calendly/scheduled-events` | GET | session | Events |
| `/api/calendly/scheduled-events/[uuid]` | GET, POST | session | One event |
| `/api/calendly/events/[uuid]/tags` | GET, POST, DELETE | session | Event tags |
| `/api/calendly/events/[uuid]/comments` | GET, POST, DELETE | session | Event comments |
| `/api/calendly/invitees` | GET | session | Invitees |
| `/api/calendly/availability` | GET | session | Availability |
| `/api/calendly/scheduling-links` | POST | session | Single-use links |
| `/api/calendly/routing-forms` | GET | session | Routing forms |
| `/api/calendly/master-calendar` | GET, POST | session | Firm-wide calendar |
| `/api/calendly/team-calendar` | GET | session | Team calendar |
| `/api/calendly/sync` | GET, POST | session | Manual sync |
| `/api/cron/calendly-sync` | GET, POST | cron | Scheduled sync (30 min) |
| `/api/calendly/webhook` | GET, POST | signature | Inbound events |
| `/api/calendly/webhook/subscribe` | GET, POST, DELETE | session | Manage subscriptions |
| `/api/calendly/activity-log` | GET | session | Sync activity |
| `/api/calendly/diagnostics` | GET | session | Connection diagnostics |

¹ Only the callback is exempt; the rest of the OAuth surface requires a session.

## 10. Zoom

| Endpoint | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/zoom/oauth/authorize` | GET | none¹ | Begin OAuth |
| `/api/zoom/oauth/callback` | GET | none¹ | OAuth redirect |
| `/api/zoom/oauth/refresh` | POST | none¹ | Refresh token |
| `/api/zoom/oauth/disconnect` | POST | none¹ | Revoke |
| `/api/zoom/connections` | GET, PATCH | session | Per-user connections |
| `/api/zoom/user` | GET | session | Zoom identity |
| `/api/zoom/token` | GET | session | Short-lived token for client SDK |
| `/api/zoom/meeting-sdk/signature` | POST | session | Meeting SDK JWT |
| `/api/zoom/meetings` | GET | session | Meetings |
| `/api/zoom/meetings/[zoomMeetingId]/join-info` | GET | session | Join details |
| `/api/zoom/meetings/[zoomMeetingId]/recordings` | GET | session | Recordings for a meeting |
| `/api/zoom/meetings/[zoomMeetingId]/summarize` | POST | admin | LLM summary of a transcript |
| `/api/zoom/meetings/[zoomMeetingId]/tags` | GET, POST, DELETE | session | Meeting tags |
| `/api/zoom/meetings/tag-counts` | GET | session | Tag rollup |
| `/api/zoom/meetings/generate-todos` | POST | session | Derive action items |
| `/api/zoom/master-meetings` | GET, POST | session | Firm-wide meeting view |
| `/api/zoom/recordings` | GET | session | Recordings |
| `/api/zoom/recordings/library` | GET | session | Browsable library |
| `/api/zoom/recordings/file` | GET | session | Download a file |
| `/api/zoom/recordings/stream` | GET | session | Stream playback |
| `/api/zoom/recordings/status` | GET | admin | Ingestion status |
| `/api/zoom/recordings/backfill` | POST | cron / admin | Backfill historical recordings |
| `/api/zoom/recordings/sync-account` | GET, POST | cron / admin | Account-wide S2S pull (05:30 UTC) |
| `/api/zoom/call-history` | GET | session | Phone call history |
| `/api/zoom/webhook` | GET, POST | signature | User-OAuth app events |
| `/api/zoom/s2s-webhook` | GET, POST | signature | Account-wide S2S app events |
| `/api/cron/zoom-todo-sweep` | GET | cron | Hourly to-do derivation |
| `/api/cron/zoom-link-sweep` | GET, POST | cron / admin | Hourly entity linking |

¹ The whole `/api/zoom/oauth/*` subtree is exempt: the Marketplace
"Add to Zoom" redirect may not carry a Hub cookie, and an auth check would
500 before the handler runs. `/authorize` is harmless without a session, and
`/callback` resolves the user via cookie, `state`, or a friendly error.

## 11. Ignition

| Endpoint | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/ignition/oauth/authorize` | GET | session | Begin OAuth |
| `/api/ignition/oauth/callback` | GET | session | OAuth redirect |
| `/api/ignition/oauth/refresh` | POST | session | Refresh token |
| `/api/ignition/oauth/disconnect` | POST | session | Revoke |
| `/api/ignition/connections` | GET | session | Connection status |
| `/api/ignition/proposals` | GET | session | Proposals |
| `/api/ignition/disbursals` | GET, PATCH | session | Disbursals |
| `/api/ignition/stats` | GET | session | Summary stats |
| `/api/ignition/reporting-overview` | GET | session | Reporting rollup |
| `/api/ignition/clients/unmatched` | GET | session | Unmatched-client queue |
| `/api/ignition/clients/[id]/match` | GET, POST, DELETE | session | Match to a Hub client |
| `/api/ignition/sync` | GET, POST | session | Manual sync |
| `/api/cron/ignition-sync` | GET | cron | Scheduled sync (15 min) |
| `/api/ignition/webhook/[event]` | GET, POST | signature | Inbound events |

## 12. Jotform (intake and feedback)

| Endpoint | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/jotform/webhook` | GET, POST | `?token=` ¹ | Form submissions |
| `/api/jotform/webhook/subscribe` | POST | session | Register a webhook |
| `/api/jotform/intake` | GET | session | Intake submissions |
| `/api/jotform/intake/[id]` | GET, PATCH | session | One submission |
| `/api/jotform/intake/[id]/karbon-work-item` | POST | session | Create Karbon work from intake |
| `/api/jotform/intake/dashboard` | GET | session | Intake dashboard |
| `/api/jotform/intake/backfill` | POST | session | Re-ingest historical submissions |
| `/api/jotform/intake/webhook-status` | GET | session | Webhook health |
| `/api/jotform/feedback` | GET | session | Feedback submissions |
| `/api/jotform/feedback/[id]` | GET, PATCH | session | One feedback record |
| `/api/jotform/forms/[formId]/webhook-status` | GET | session | Per-form webhook health |
| `/api/jotform/health` | GET | session | Integration health |

¹ Free-tier Jotform cannot sign payloads. The handler requires a `token`
query parameter matching `jotform_forms.webhook_secret`. **That token is the
only credential protecting the intake pipeline** — rotate it like a secret.

## 13. Meetings and debriefs

| Endpoint | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/meetings` | GET | session | Hub meetings |
| `/api/meetings/[id]` | GET | session | One meeting |
| `/api/meetings/sync` | POST | cron / admin | Rebuild from Calendly + Zoom |
| `/api/debriefs` | GET, POST | session | Debriefs |
| `/api/debriefs/[id]` | PATCH, DELETE | session | Update / soft-delete |
| `/api/debriefs/comments` | GET, POST | session | Comments |
| `/api/debriefs/attachments` | POST, DELETE | session | Attachments (Blob) |
| `/api/debriefs/link` | GET, POST | session | Link a debrief to a meeting |
| `/api/cron/debrief-reminder` | GET | cron | Hourly missing-debrief nudge |
| `/api/cron/meeting-summary` | GET | cron | Weekly summary (Mon 13:00 UTC) |
| `/api/cron/meeting-summary-ingest` | GET | cron | Hourly Zoom AI summary ingest |

## 14. Sales and revenue

| Endpoint | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/sales/dashboard` | GET | session | Sales dashboard |
| `/api/sales/proposals` | GET | session | Proposals |
| `/api/sales/proposals/[id]` | PATCH | session | Update a proposal |
| `/api/sales/proposals/[id]/state` | PATCH | session | Transition state |
| `/api/sales/invoices` | GET | session | Invoices |
| `/api/sales/invoices/[id]` | PATCH | session | Update an invoice |
| `/api/sales/payments` | GET | session | Payments |
| `/api/sales/payment-links` | GET, POST | session | Stripe payment links |
| `/api/sales/payment-links/[id]` | PATCH | session | Update a link |
| `/api/sales/recurring-revenue` | GET | session | MRR/ARR rollup |
| `/api/sales/services` | GET | session | Service catalog |
| `/api/sales/service-packages` | GET | session | Packages |
| `/api/services` | GET, POST | session | Services |
| `/api/services/categories` | GET | session | Categories |
| `/api/webhooks/stripe` | POST | signature | Stripe events |

## 15. Prospects and leads

| Endpoint | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/prospects` | POST | session | Create a prospect |
| `/api/prospects/[id]` | GET, PATCH | session | One prospect |
| `/api/prospects/[id]/attachments` | POST, DELETE | session | Attachments |
| `/api/prospects/[id]/karbon-work-item` | POST | session | Create Karbon work |

## 16. ALFRED

The cross-origin AI surface. Serves both the in-Hub `/alfred` page and
`alfred.motta.cpa`.

| Endpoint | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/alfred/health` | GET, OPTIONS | **none** | Unauthenticated status probe |
| `/api/alfred/whoami` | GET, OPTIONS | alfred-user | Resolved caller identity |
| `/api/alfred/chat` | POST, OPTIONS | alfred-user¹ | Streaming chat with 18 tools |
| `/api/alfred/conversations` | GET, DELETE, OPTIONS | alfred-user | List / clear conversations |
| `/api/alfred/conversations/[id]` | GET, DELETE, OPTIONS | alfred-user | One conversation |
| `/api/alfred/data` | GET, POST | alfred-secret | Governed table reads |
| `/api/alfred/schema` | GET | alfred-secret | Table + column catalog |
| `/api/alfred/search` | GET | alfred-secret | Cross-table free-text search |
| `/api/alfred/stats` | GET | alfred-secret | Row counts and aggregates |

¹ The route itself is gated only on caller identity. One **tool**
(`pullZoomRecordings`) calls `requireAdmin()` inside its `execute`, because
triggering a service-role account-wide sync is privileged; a non-admin gets
a refusal message rather than a 403. No other tool is role-gated.

### Governed data access

`/api/alfred/{data,schema,search,stats}` read only the **72 tables and
views** in `ALLOWED_TABLES` (`lib/alfred/allowed-tables.ts`). Anything not on
that list is rejected by `isAllowedTable()` regardless of caller.

`/api/alfred/schema` returns each table's `key_columns`, which is what makes
the model able to compose a correct `queryDatabase` call on the first
attempt rather than guessing column names.

### Chat tools

| Category | Tools |
|---|---|
| Generic | `queryDatabase`, `searchAcrossTables`, `getDatabaseStats` |
| Domain | `getWorkItemsSummary`, `getTeamWorkload`, `getClientInfo`, `getUpcomingDeadlines`, `getRecentActivity`, `getServices`, `getFinancialSummary`, `getDealPipeline`, `getProjects`, `findPerson`, `getTommyAwardsLeaderboard` |
| Caller-scoped | `getMyWorkItems`, `getMyUpcomingDeadlines` |
| Zoom actions | `getZoomRecordingStatus`, `pullZoomRecordings` |

`buildPolicy()` (`lib/alfred/policy.ts`) filters this map per audience and
narrows `queryDatabase`'s table parameter. `Audience` is
`"staff" | "client"`; the **`client` branch is unimplemented and throws**,
surfaced as a `403`. Enabling a client-facing UI requires a deliberate
change there.

### Model

`ALFRED_CHAT_MODEL` → `anthropic/claude-sonnet-4.6`, via the Vercel AI
Gateway. Change it in `lib/ai/models.ts`, not at the call site.

## 17. Public API (motta.cpa)

Anonymous surface. Each route enforces its own CORS origin allow-list,
honeypot field, and per-IP rate limit; alternatively callable
server-to-server with `x-motta-public-secret`. See
[public-api.md](./public-api.md) for the full contract with the marketing
project.

| Endpoint | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/public/health` | GET, OPTIONS | public-cors | Liveness |
| `/api/public/stats` | GET, OPTIONS | public-cors | Firm hero stats |
| `/api/public/contact` | POST, OPTIONS | public-cors | Contact form |
| `/api/public/intake` | OPTIONS | public-cors | Intake preflight¹ |
| `/api/public/newsletter` | POST, OPTIONS | public-cors | Subscribe |
| `/api/public/newsletter/confirm` | GET, POST, OPTIONS | public-cors | Double opt-in |
| `/api/public/newsletter/unsubscribe` | POST, OPTIONS | public-cors | Unsubscribe |
| `/api/public/pay/[token]/session` | POST | token | Create a Stripe checkout session |
| `/api/public/pay/[token]/status` | GET | token | Payment status |

¹ `/api/public/intake` exports only `OPTIONS`; submissions route through
Jotform.

Public pages: `/welcome`, `/embed/contact`, `/embed/intake`, `/legal/*`,
`/docs/*`. The legal and docs pages must remain reachable without auth for
Zoom Marketplace review.

## 18. Notifications and messaging

| Endpoint | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/notifications` | GET, PATCH | session | List / mark read |
| `/api/notifications/preferences` | GET, PUT | session | Per-user preferences |
| `/api/notifications/send` | POST | session | Dispatch a notification |
| `/api/messages` | GET, POST | session | Internal messages |
| `/api/messages/[id]` | GET, POST, PATCH, DELETE | session | One message |
| `/api/messages/comments` | POST | session | Comment |
| `/api/messages/reactions` | POST | session | React |
| `/api/email/broadcast` | POST | session | Firm-wide email (Resend) |
| `/api/email/broadcast/attachments` | POST, DELETE | session | Broadcast attachments |
| `/api/cron/daily-briefing` | GET | cron | Weekday briefing (12:00 UTC, Mon–Fri) |

## 19. Dashboards, triage, views

| Endpoint | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/dashboard/stats` | GET | session | Headline metrics |
| `/api/dashboard/details` | GET | session | Drill-down |
| `/api/triage/feed` | GET | session | Items needing attention |
| `/api/triage/dismiss` | POST, DELETE | session | Dismiss / restore |
| `/api/triage/clear` | POST | session | Clear all |
| `/api/views` | GET, POST, PUT, DELETE | session | Saved views |

## 20. Content

| Endpoint | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/resources/documents` | GET, POST | session | Resource library |
| `/api/resources/documents/[id]` | PATCH, DELETE | session | One document |
| `/api/training/videos` | GET, POST | session | Training videos |
| `/api/training/videos/[id]` | GET, PATCH, DELETE | session | One video |
| `/api/training/videos/bulk` | POST | session | Bulk import |
| `/api/training/categories` | GET | session | Categories |
| `/api/motta-alliance/issues` | GET, POST | session | Alliance issues |
| `/api/motta-alliance/upload` | POST | session | Alliance upload |

## 21. Tommy Awards

| Endpoint | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/tommy-awards` | GET | session | Standings and weeks |
| `/api/tommy-awards/ballot` | POST | session | Submit a ballot |
| `/api/tommy-awards/recap/regenerate-image` | POST | cron | Rebuild podium image |
| `/api/cron/tommy-ballot-reminder` | GET | cron | Thu 19:00/20:00 UTC (DST pair) |
| `/api/cron/tommy-weekly-recap` | GET | cron | Fri 12:45/13:45 UTC (DST pair) |
| `/api/cron/tommy-recap-send` | GET | cron | Fri 16:00/17:00 UTC (DST pair) |
| `/api/cron/tommy-podium-image` | POST | cron | Podium image build |
| `/api/cron/tommy-recap-pdf` | POST | cron | Recap PDF build |

Consecutive-hour pairs are DST straddles for a fixed Eastern wall-clock
time; `lib/cron-eastern.ts` decides which firing acts.

## 22. Direct Supabase read endpoints

Thin pass-throughs used by client components that need a table or view
directly. Session-authenticated; no write methods except where noted.

| Endpoint | Methods |
|---|---|
| `/api/supabase/clients` | GET |
| `/api/supabase/contacts` | GET |
| `/api/supabase/organizations` | GET |
| `/api/supabase/client-groups` | GET |
| `/api/supabase/work-items` | GET |
| `/api/supabase/work-items/counts` | GET |
| `/api/supabase/debriefs` | GET |
| `/api/supabase/debriefs/tag` | POST |
| `/api/supabase/calendly-events` | GET, POST |
| `/api/supabase/service-lines` | GET |
| `/api/supabase/signed-proposal-clients` | GET |

## 23. Legacy and migration

| Endpoint | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/airtable/tables` | GET | session | Airtable table list |
| `/api/airtable/[tableId]` | GET | session | Airtable records |
| `/api/migration/airtable-to-supabase` | POST | session | One-off migration |
| `/api/playground/claude` | POST | session | Model playground (`/playground/claude`) |

---

## Appendix A — Endpoints by auth class

**Deliberately unauthenticated (2):** `/api/alfred/health`,
`/api/auth/forgot-password`

**Public CORS (9):** all of `/api/public/*`

**Signature-verified webhooks (8):** `/api/karbon/webhooks`,
`/api/calendly/webhook`, `/api/zoom/webhook`, `/api/zoom/s2s-webhook`,
`/api/proconnect/webhooks`, `/api/webhooks/stripe`,
`/api/ignition/webhook/[event]`, `/api/jotform/webhook` (token, not signature)

**OAuth callbacks exempt from middleware (3):**
`/api/calendly/oauth/callback`, `/api/proconnect/oauth/callback`,
`/api/zoom/oauth/*` (whole subtree)

**Admin-gated (18):** `/api/admin/ai/config`, `/api/admin/ai/usage`,
`/api/admin/firm-settings`, `/api/admin/unlinked-records/link`,
`/api/auth/test-smtp`, `/api/cron/zoom-link-sweep`,
`/api/karbon/webhooks/events/retry`, `/api/karbon/webhooks/subscriptions`,
`/api/meetings/sync`, `/api/proconnect/oauth/connect`,
`/api/proconnect/oauth/disconnect`, `/api/team-members/invite-user`,
`/api/team-members/setup-auth`, `/api/team-members/sync-auth-users`,
`/api/zoom/meetings/[id]/summarize`, `/api/zoom/recordings/backfill`,
`/api/zoom/recordings/status`, `/api/zoom/recordings/sync-account`

**Leadership-gated (3):** `/api/firm/hours`, `/api/proconnect/sync`,
`/api/proconnect/returns/[returnId]/import/[seriesId]`

**Cron-authenticated (23):** all `/api/cron/*` plus `/api/karbon/sync`,
`/api/karbon/sync-tenant-config`, `/api/meetings/sync`,
`/api/proconnect/sync`, `/api/tommy-awards/recap/regenerate-image`,
`/api/zoom/recordings/backfill`, `/api/zoom/recordings/sync-account`

**Everything else (~230):** any active team member.

> The gap between 21 role-gated routes and ~230 session-only routes is the
> platform's most significant authorization characteristic: **an
> authenticated team member can read essentially all firm data**, including
> tax detail and compensation-adjacent records. That is a deliberate
> small-firm posture, not an oversight — but it should be a conscious
> decision each time the staff roster grows or a contractor is onboarded.

## Appendix B — Destructive operations

Operations that write outside the Hub's own database, ordered by blast
radius. Everything here should be treated as requiring explicit intent.

| Operation | Endpoint | Gate |
|---|---|---|
| Write tax values into Intuit | `POST /api/proconnect/returns/[id]/import/[seriesId]` | leadership |
| Write a contact / organization to Karbon | `PATCH,PUT /api/karbon/{contacts,organizations}/[key]` | session |
| Write a work item / task to Karbon | `PATCH,PUT /api/karbon/work-items/[key]`, `/api/karbon/tasks/[key]` | session |
| Post a note to Karbon | `POST /api/karbon/notes`, `…/work-items/[key]/notes` | session |
| Create a Karbon work item from intake | `POST /api/jotform/intake/[id]/karbon-work-item` | session |
| Firm-wide email | `POST /api/email/broadcast` | session |
| Create a Stripe payment link | `POST /api/sales/payment-links` | session |
| Invite / provision an auth user | `POST /api/team-members/invite-user` | admin |
| Revoke an integration | `/api/*/oauth/disconnect` | admin or session |

Note that most Karbon writes are only `session`-gated. A mistaken PATCH
propagates to the firm's practice-management system of record.
