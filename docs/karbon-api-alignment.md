# Karbon API Reference — Alignment Review for Motta Hub / ALFRED

Source of truth: <https://karbonhq.github.io/karbon-api-reference/KARBON_API.md>
Reviewed against: `lib/karbon-api.ts`, `lib/karbon-utils.ts`, `lib/karbon/*`,
`app/api/karbon/**`, mappers, webhook subscriber, ALFRED schema/tools.

## Executive Summary

The Motta Hub Karbon integration is broadly correct: OData query building,
nextLink-based pagination, two-header auth, the 8-type webhook subscription
catalog, and the tenant-config sync (statuses + types + templates) all line up
with the spec. There are, however, **four real spec-compliance bugs** —
including one (PrimaryStatus values) that would silently produce wrong filter
results and reject any POST/PUT we sent to Karbon — plus several capabilities
the spec exposes that ALFRED could productively use.

The findings are grouped below by severity.

---

## P0 — Spec-compliance bugs (fix before further Karbon writes)

### 1. PrimaryStatus values are wrong

**Spec (fixed, not tenant-specific):**
`Planned | Ready To Start | In Progress | Waiting | Completed`

**Current code:**
- `lib/karbon-api.ts` `KARBON_PRIMARY_STATUSES` -> `Not Started, In Progress, Waiting, Completed, Cancelled`
- `lib/karbon-utils.ts` `KARBON_PRIMARY_STATUSES` -> same wrong set
- `app/api/clients/[id]/route.ts:811` filters on `["In Progress", "Ready To Start", "Waiting", "Planned", "Not Started"]`
- Multiple UI components (`bookkeeping-dashboard`, `project-plan-*`,
  `service-pipeline`) bucket on `"Not Started"`

`"Not Started"` and `"Cancelled"` are **not valid Karbon PrimaryStatus values**.
Karbon's only "not yet started" primary states are `Planned` and `Ready To Start`.
Any `$filter=PrimaryStatus eq 'Not Started'` request returns zero rows, and any
`POST/PUT /v3/WorkItems` body with that value is rejected. The reason this
hasn't blown up is that we currently **only read** PrimaryStatus from Karbon
(into `work_items.primary_status`) — we don't filter on it server-side or POST
work items with it. But:

- Statuses are now written after creation by `lib/karbon/finalize-work-item.ts`
  (§4a), which sends the enum form (`InProgress`) via `toKarbonPrimaryStatus`.
- The `/api/karbon/work-items?status=Not%20Started` query builder will silently
  return nothing.
- ALFRED's prompt and tools use the wrong vocabulary when reasoning about
  Karbon work.

**Fix:**
- Make `lib/karbon-api.ts` the single source of truth and align `karbon-utils.ts`
  to the spec values.
- Add a `mapInternalToKarbonPrimaryStatus()` translator for the UI buckets
  (`Not Started` -> `Planned`; our internal `Cancelled` has no Karbon
  PrimaryStatus equivalent — it lives in tenant-specific Secondary statuses).
- Audit the `app/api/clients/[id]/route.ts` "active" filter and the
  project-plan/bookkeeping bucket constants.

### 2. FeeType comparisons use the wrong literals

**Spec:** `FeeSettings.FeeType` is one of `FixedFee | TimeAndMaterials | NonBillable`,
with `FeeValue` populated only for `FixedFee`.

**Current code (`app/api/karbon/work-items/route.ts:100-103`,
`lib/karbon/mappers/work-item.ts`):**

```ts
fixed_fee_amount: feeSettings.FeeType === "Fixed"  ? feeSettings.FeeValue : null,
hourly_rate:      feeSettings.FeeType === "Hourly" ? feeSettings.FeeValue : null,
```

`"Fixed"` and `"Hourly"` aren't Karbon values, so `fixed_fee_amount` and
`hourly_rate` on `work_items` are always `NULL` even when the work item really
is a fixed-fee engagement. This is the most likely cause of the under-reported
engagement profitability we've been chasing.

**Fix:** match `"FixedFee"`, drop `hourly_rate` (Karbon doesn't return an
hourly rate at the work-item level — it's per-user via `EstimateSummaries`),
and run a one-time backfill via the webhook re-fetch path.

### 3. PATCH /WorkItems — what it accepts (updated 2026-11)

> **Superseded.** This section used to say PATCH supports only `Description`
> and `DeadlineDate`. Karbon has since widened the endpoint; the facts below
> are from the current reference and are what the Hub now relies on.

`PATCH /v3/WorkItems/{WorkItemKey}` accepts exactly these properties — any
other key in the body is a `400`:

`Title`, `Description`, `StartDate`, `DueDate`, `DeadlineDate`,
`AssigneeEmailAddress`, `WorkType`, `UserRoleAssignments`, `PrimaryStatus`,
`SecondaryStatus`, `FeeSettings`

Rules that matter in practice:

- **Statuses are written by NAME.** There is no `WorkStatusKey` on a work
  item. `SecondaryStatus` requires `PrimaryStatus` in the same body, must
  belong to that primary, and must be enabled for the work item's
  `WorkType` — otherwise `400`. Sending `PrimaryStatus` alone *clears* the
  secondary status.
- `PrimaryStatus` is the fixed enum `Planned | ReadyToStart | InProgress |
  Waiting | Completed` (reads may return the spaced form, "In Progress").
- Success is **`204 No Content`** — an empty body. `karbonFetch` treats an
  empty body on a write as success (it used to throw on `.json()` and
  report every successful PATCH as a failure).
- `409` is an optimistic-concurrency conflict and is routine immediately
  after a create, while Karbon is still applying the template. `429` is the
  rate limit. Both are retried (`patchKarbonWorkItem`).
- There is no `Budget` / `BudgetedHours` on a work item. Time budgets live
  in per-user `EstimateSummaries`.

**Where the Hub uses it:** `lib/karbon/finalize-work-item.ts` — the
post-create step every Hub work-item creator runs (see §4a).

### 4. POST /WorkItems required fields not validated client-side

**Spec required:** `AssigneeEmailAddress, Title, ClientKey, ClientType, StartDate`.

There are two POST paths: `lib/karbon/create-intake-work-item.ts` (the
one-click prospect 1040) and `lib/karbon/create-work-item.ts` (any template,
used by the work-item builder, the prospect form and debriefs). The generic
creator refuses to POST without an assignee and always sends a `StartDate`.
It no longer sends `WorkStatusKey` or `Budget` — neither is a WorkItem
property — and sends `WorkType` as the work type's **name**, not its key.

### 4a. Post-create set-up of Hub-created work items (added 2026-11)

Creating a work item from a template leaves it on the template's defaults.
Once the item exists, `finalizeKarbonWorkItem` follows up with two PATCHes —
dates first, then status, so an automator that fires on the status change
already sees the right dates, and a rejected status can't take the dates
down with it.

| What | Rule |
|---|---|
| **Applies to** | Tax-preparation work types only, matched on the form number in the work type name: 1040, 1065, 1120-S, 1120, 1041 (Trusts & Estates), 709, 990. Planning, estimates, IRS support, S-Corp election etc. are left alone. |
| **Tax year** | The fiscal-year field if it holds a year, else the last `\|` segment of the title, else the seasonal default (Jan 1 – Apr 15 Eastern → last year; otherwise this year). |
| **StartDate** | 12/31 of the tax year. |
| **DueDate / DeadlineDate** | The return's original filing date in the following year: 4/15 for 1040 / 1120 / 1041 / 709, 3/15 for 1065 / 1120-S. Nominal dates — no weekend roll — matching how the firm's existing work items are dated. **990s get no automatic dates** (fiscal-year filers). |
| **Status (prospect / intake work)** | `In Progress › Lead \| Meeting Schd` when the prospect has an active, upcoming Calendly meeting; otherwise `In Progress › Lead \| Awaiting Intake`. The live status name is looked up in the `work_status` mirror so a rename in Karbon keeps working. |
| **Status (existing-client work, e.g. from a debrief)** | Left on the template default. |
| **Teammate's choices win** | A start / due date or a status picked in the Hub is sent as chosen. |
| **Booking after the work item exists** | When a Calendly booking lands, `advanceLeadWorkItemsOnBooking` re-reads each of that prospect's Hub-created tax work items **from Karbon** and moves it to `Lead \| Meeting Schd` only if it is still on `Lead \| Awaiting Intake`, `LEAD \| Prospect`, or the untouched template default. Anything further along (debrief, discovery, proposal, prep, completed) is never pulled back. |

The step never fails a create — the work item already exists — but its
outcome is returned as `finalize` and shown to the teammate, so a status
Karbon refused is visible rather than silent. The pure rules live in
`lib/karbon/tax-work-item-defaults.ts`; `scripts/435-…` and `scripts/436-…`
exercise them offline.

---

## P1 — Robustness / production-readiness

### 5. Rate limit (429) is not retried

`karbonFetch` and `karbonFetchAll` don't honor `Retry-After`. Karbon's
documented response is `429 { message: "Try again in 10 seconds." }`. Today a
single 429 during a sync run silently truncates results.

**Fix:** parse the seconds from the message (or the `Retry-After` header if
present), `await sleep`, and retry up to 2x per request.

### 6. `top` should be capped at 100

`buildODataQuery` accepts any `top`. Spec says max 100 for most endpoints.
Pass-through of e.g. `top=500` from a caller silently caps at Karbon's
server-side limit but invalidates our pagination math.

**Fix:** clamp `top` to `[1, 100]` inside `buildODataQuery`.

### 7. `@odata.count` requires `$count=true` on some endpoints

`karbonFetchAll` returns `totalCount` as `data["@odata.count"]`, which is
`undefined` on endpoints that need an explicit `$count=true`. Our drift
detection (`work-items/route.ts:377`) falls back to `allWorkItems.length`,
masking missing pages.

**Fix:** opt-in `count: true` in `ODataQueryOptions`, append `&$count=true`
when set, and use it from the work-item / contact / org sync paths.

### 8. `$filter` operator constraints aren't enforced

The spec is explicit:
- WorkItems: `contains` is **not** supported on `ClientKey`, `PrimaryStatus`,
  or `WorkScheduleKey`
- ClientGroups: only `eq` on `FullName`
- Users: only `eq` on `Name` / `EmailAddress`
- Invoices: only `eq` on `InvoiceStatus`

Our routes currently build filter strings with no awareness of these limits.
Low risk today (the routes pass through user-supplied query params), but
ALFRED's tool-calling layer can produce invalid filters.

**Fix:** add a small `validateOdataFilter(endpoint, filterFields)` helper used
by ALFRED's Karbon tools (not by the dumb proxy routes).

---

## P2 — Capabilities not yet leveraged

### 9. `EstimateSummaries/{WorkItemKey}` is a real, addressable endpoint

Spec: read-only, returns per-user `HourlyRate, EstimateMinutes, ActualMinutes`.
Our `upsertEstimateSummaryByWorkItemKey` (`lib/karbon/upsert.ts:235`) just
re-fetches the parent work item — it never reads the actual EstimateSummary
detail. That's a missed opportunity for **per-user budget vs actual** in the
Tommy weekly recap and the ALFRED capacity views, which today have to derive
it from timesheets.

**Proposed:** new table `karbon_estimate_summaries(work_item_key, user_key,
hourly_rate, estimate_minutes, actual_minutes, last_synced_at)` plus a real
fetch in the upsert function. Wire `EstimateSummary` webhook events through to
it. (We already subscribe to that webhook type — `KARBON_WEBHOOK_TYPES` —
the events just don't go anywhere meaningful yet.)

### 10. `Timesheets` `WorkItemKeys/any(x: x in (...))` batched filter

Spec workflow #2. Today our timesheet sync pulls everything by date range.
For "active work" reports we can batch by `WorkItemKey` instead and avoid
pulling completed-work timesheets we don't need — meaningfully faster for the
weekly Tommy recap.

### 11. `UserDefinedIdentifier` lookup endpoints

Spec exposes:
- `GET /v3/Contacts/GetContactByUserDefinedIdentifier(UserDefinedIdentifier='{id}')`
- `GET /v3/Organizations/GetOrganizationByUserDefinedIdentifier(UserDefinedIdentifier='{id}')`
- `GET /v3/ClientGroups/GetClientGroupByUserDefinedIdentifier(UserDefinedIdentifier='{id}')`

These are **direct hits** vs. our current pattern of paginating + filtering by
key. Worth using in ALFRED's `karbon_lookup_client_by_id` tool (Jotform sends a
`UserDefinedIdentifier` with each intake — today we resolve it by listing
contacts and matching client-side).

### 12. `Colleague` custom field — two-step user resolution

Spec workflow #3. We store `custom_fields` jsonb verbatim. Where the field
type is `Colleague`, the value is a `UserKey` array — we never hydrate it to a
user name. Adding a one-liner `resolveColleagueField()` would unblock e.g.
"Show me all contacts where Relationship Manager = Bea" in ALFRED.

### 13. WorkSchedules POST/PUT for repeating work

Spec workflow #5. We sync `WorkTemplates` (good), but we never **create**
recurring schedules from Motta Hub. The bookkeeping recurring-engagement flow
(`/admin/bookkeeping`) currently asks the user to set up the recurrence in
Karbon manually after the engagement is created. Workflow #5 in the spec is
exactly the pattern we need to automate that.

### 14. Notes endpoint accepts HTML

`POST /v3/Notes` `Body` is HTML-capable. Our note creation
(`app/api/clients/[id]/notes/route.ts`) sends plain text. Nothing breaks, but
the daily-briefing summaries would render better in Karbon if posted as the
HTML we already generate for email.

---

## P3 — Documentation only

- **Tags is beta** — there are no `/v3/Tags` paths. Anywhere in the code that
  references a tags endpoint should be removed or guarded.
- **`ClientAccessActivated`** in `TenantSettings` — we don't read it. The
  `ClientAccess` `$expand` on Contacts is silently ignored unless this flag is
  true. Worth surfacing in `/admin/karbon-sync` so the admin knows.
- **Webhook auto-cancel after 10 failed deliveries** — our subscription manager
  should track `consecutive_failures` and auto-resubscribe.

---

## Proposed implementation order

The bugs in P0 are all in the same blast radius (status vocabulary + fee
mapping), so they should ship together. P1 #5 and #6 are 5-line changes inside
`karbon-api.ts`. The capability adds (P2) are each meaningful surface-area
expansions and should be sequenced behind the bugfixes.

1. **P0 bugfix bundle** — status constants, fee literals, PATCH wrapper, POST
   validation. One PR, one migration to backfill `fixed_fee_amount` from the
   webhook re-fetch.
2. **P1 robustness** — 429 retry, top clamp, `$count=true` opt-in, ALFRED
   filter validator. One PR.
3. **P2 capability — per-user estimate summaries** (#9). New table + mapper +
   webhook wiring + ALFRED schema entry.
4. **P2 capability — UDI lookups + colleague field resolution** (#11, #12).
   ALFRED-only; no schema change.
5. **P2 capability — recurring WorkSchedule creation** (#13). UI work in
   `/admin/bookkeeping`.
