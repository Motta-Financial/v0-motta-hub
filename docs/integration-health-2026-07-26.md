# Integration & Connection Test — 2026-07-26

Tested every live integration against the production database, the
deployed Hub, and the provider-side registrations. Verdict per system,
then the actions that must be taken **outside** the codebase.

## Verdict

| Integration | Auth / tokens | Data flowing | Webhooks | Verdict |
| --- | --- | --- | --- | --- |
| **Karbon** | Key valid for most endpoints, **401 on `/v3/TenantSettings`** | Yes — work_items fresh (16:59), 2,850 timesheets | 8 subs, all → `hub.motta.cpa`, **unsigned** | ⚠️ Degraded |
| **ProConnect (Intuit)** | Healthy, refreshes on demand | Clients 2,253 · engagements 908 | Client+TaxReturn deliver; **return data 403** | ⚠️ Blocked externally |
| **Calendly** | 4 accounts active, auto-refreshing | Yes — polling every 30 min | **ZERO registered** | ⚠️ Real-time path dead |
| **Zoom** | 7 accounts active, auto-refreshing | Meetings 198 · recordings 287 · transcripts 252 | Delivering + signature-verified | ✅ Fixed this pass |
| **Ignition** | Active, refreshing | Yes — synced 19:45, 192 clean runs / 48h | Deprecated by design (410) | ✅ Healthy |
| **Jotform** | Both forms wired with secrets | 240 intake · 44 feedback | Registered → `hub.motta.cpa` | ✅ Healthy |
| **Stripe** | Keys present in Vercel | No payments yet (feature unused) | Signature-verified receiver | ✅ Ready |
| **Supabase** | — | — | — | ✅ Healthy |

**All webhook target URLs are correct.** Every registration points at
`https://hub.motta.cpa/...`. No URL corrections are needed anywhere.

## Fixed in this pass

### Zoom AI Companion summaries were 100% dropped

`meeting.summary_completed` keys its object as `meeting_uuid` /
`meeting_id`, **not** the `uuid` / `id` used by the recording events.
`lib/zoom-webhook-handlers.ts` read `obj.uuid`, found nothing, and
returned `missing_uuid` — so **every** summary since the feature went
live failed (133 events, most recent 2026-07-24). Each payload carries a
full recap plus per-person next steps with Zoom task links.

- Handler now reads the prefixed keys (with `uuid`/`id` fallbacks).
- `scripts/357` replayed the stored payloads: **56 meetings recovered**
  summaries (51 with full content). 19 events had no matching Hub
  meeting (host never connected / outside the sync window) and are
  marked `skipped`.
- Recurring meetings collapse to one `zoom_meetings` row per
  `meeting_id`, so such a row holds the most recent occurrence's
  summary. That is the table's existing grain, not a regression.

## ⚠️ Actions required outside the codebase

### 1. Register Calendly webhooks — real-time booking flow is dead

`calendly_webhook_subscriptions` and `calendly_webhook_events` are both
genuinely empty: **no Calendly webhook has ever been registered.** The
30-minute polling sync (`lib/calendly-sync.ts`) records the event and
matches invitees to *existing* contacts, but only the webhook receiver
runs the rest of the pipeline. So for every new booking these never fire:

- the "New Meeting Booked" team email (`notifyTeamOfNewBooking`)
- ALFRED triage / auto-tagging (`runAlfredCalendlyTriage`)
- Hub-contact auto-creation for a brand-new prospect (`findOrCreateHubContact`)
- the Karbon push and deal creation that hang off it

This is consistent with `calendly_event_clients` holding only 49 links
against 228 events.

**Fix:** `POST /api/calendly/webhook/subscribe` with
`{ "connectionId": "<id>", "scope": "organization" }` while signed in.
The `webhooks:write` scope is already granted, and the endpoint is
idempotent. Organization scope covers all users in one subscription;
otherwise repeat per connection. Verify afterwards that
`calendly_webhook_subscriptions` is non-empty and that
`calendly_webhook_events` starts filling.

### 2. Grant Karbon API access to `/v3/TenantSettings`

The `tenant-config` sync has run `partial_failure` every 4 hours for at
least 48 hours — `"401: Unauthorized; 401: Unauthorized"`, latest
18:16 today. It is **endpoint-specific, not a bad key**:

- `/v3/WorkTemplates` succeeds — `work_templates` updated 18:16 today
- `/v3/TenantSettings` 401s — `work_status` last updated **2026-06-24**

So the firm's work-status and work-type taxonomy is **a month stale**;
new or renamed Karbon statuses won't appear in Hub filters. Impact is
low (the taxonomy rarely changes) but it will drift.

**Fix in Karbon:** the API user behind `KARBON_BEARER_TOKEN` /
`KARBON_ACCESS_KEY` needs permission to read tenant settings — typically
an admin/settings role. Re-run afterwards via
`POST /api/karbon/sync-tenant-config`.

### 3. Set `KARBON_WEBHOOK_SIGNING_KEY` — webhooks are unverified

All 8 Karbon subscriptions report `signing_key_configured: false`, so
`/api/karbon/webhooks` accepts unsigned payloads. Since middleware
exempts that path from session auth (it must, for delivery), anyone who
knows the URL can post forged Karbon events and mutate Hub data.

**Fix:** generate a secret, set `KARBON_WEBHOOK_SIGNING_KEY` in Vercel,
then re-subscribe (`POST /api/karbon/webhooks/subscriptions`, now
admin-gated) so Karbon is given the same key.

### 4. Intuit allow-listing — still the ProConnect blocker (unchanged)

72 `TaxReturn` webhook events failed with `export failed: scope_missing
403`, most recent **today 09:18**, and `integration_alerts` carries
`proconnect_phase1_export`. `proconnect_return_snapshots` and
`proconnect_return_field_cells` are genuinely 0 — no return data has
ever landed, which is why the 1040 viewer has nothing to show.

**Fix:** Intuit must allow-list realm **9130356180193146** for the
Phase 1 Export/Import endpoints. Nothing in the codebase can work around
a 403 on the scope.

## Notes / lower priority

- **Karbon webhook types never observed:** `Work`, `User`, `Invoice`,
  `IntegrationTask`, `CustomField` have `last_event_at = NULL` (only
  `Contact`, `EstimateSummary`, `Note` have ever fired). `Work` is the
  surprising one — worth confirming those event types are enabled on the
  Karbon side, since work items are core to the Hub.
- **ProConnect token expiry is expected.** The access token shows expired
  (1-hour lifetime) because the redundant pg_cron refresher was removed.
  `getAccessToken()` in `lib/proconnect/oauth.ts` refreshes on demand
  behind a buffer, so the next call re-mints it — verified by reading the
  code path, not assumed.
- **Historical ProConnect failures are resolved:** 1,599 `Client` 404s
  (last 2026-07-10) and 326 429s (last 2026-06-29) both stopped after
  the single-client-fetch fix. No recurrence in 16 days.
- **Stale Calendly connection:** `savvinazekiou@gmail.com` is inactive
  with a token expired 2026-07-21 — a personal Gmail account, safe to
  delete.
- **Ignition connection metadata** (`ignition_user_email`,
  `ignition_practice_name`) is NULL — cosmetic only; sync works.
- **17 old `recording.completed` failures** (last 2026-05-29) read
  `"no unique or exclusion constraint matching the ON CONFLICT
  specification"`. Not recurring, but it indicates an upsert whose
  target constraint may still be missing. Left alone; flagged.

## Method

Read from the live database (token expiry, sync logs, webhook event
outcomes and error text, registered target URLs), the deployed Vercel
projects, and the repo's handler code. No provider API keys are
available in this environment, so provider-side state was inferred from
the delivery/error record rather than by calling Karbon or Intuit
directly. Every "0 rows" conclusion was re-confirmed with `count(*)`
after planner estimates proved stale.
