# ProConnect ↔ ALFRED Hub Integration — Platform Review & Remediation

**Date:** 2026-07-10
**Scope:** Full review of the GitHub repo (`Motta-Financial/v0-motta-hub`), the Vercel team ("Motta"), and the Supabase project ("Motta Hub", `gylupzxitoebhqjnvzuw`), focused on making the Intuit ProConnect Tax integration fully operational and wired into ALFRED.

---

## 1. Platform inventory

| Layer | Resource | Notes |
|---|---|---|
| Vercel | **`mottahub`** → `hub.motta.cpa` | **The real production project.** Env vars configured; webhooks and app traffic land here. |
| Vercel | **`v0-motta-hub`** → `v0-motta-hub.vercel.app` | **Duplicate project on the same repo.** Missing `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (and likely more). Its crons fire daily and fail. |
| Vercel | `alfred` → `alfred.motta.cpa` | ALFRED frontend. Healthy. |
| Supabase | `Motta Hub` (`gylupzxitoebhqjnvzuw`) | Production DB + 20 edge functions (many are one-off investigation tools). |
| Supabase | `ALFREDAi` (`bywhzvvyqmsjhaqgcrlk`) | Separate project, not referenced by this repo's ProConnect code. |
| Intuit | Realm `9130356180193146`, scope `com.intuit.proconnect.taxreturns` | OAuth token healthy — auto-refreshing hourly, `last_refresh_error` null. |

Data snapshot at review time: 2,062 `proconnect_clients`, 901 `proconnect_engagements`, 21 custom statuses, 4,959 webhook events.

## 2. What was broken (with evidence)

### 2.1 The nightly sync has not run since May
`/api/cron/proconnect-sync` (daily 06:00 UTC) proxied to a Supabase Edge Function named **`proconnect-sync` that was never deployed**:

- On `mottahub`: `Edge Function failed: 404 — Requested function was not found` — every day, first seen 2026-05-23.
- On `v0-motta-hub`: `Failed to parse URL from undefined/functions/v1/proconnect-sync` — `SUPABASE_URL` unset on that project.

Last (manual, partial) syncs in `proconnect_sync_logs` are from **June 14**. The integration survived on webhooks alone.

### 2.2 Every Client webhook failed — 1,914 events
`Client Create/Update` processing called `GET /v1/clients/{id}`, which **ProConnect does not support** (returns a bare Tomcat 404 page — the ProConnect Open API docs only define `GET /v1/clients`). 1,580 events failed with that 404 and another 326 with `429 Too Many Requests` (each entity in a webhook batch triggered its own full-list fetch once retries kicked in). Client data has been stale since late May.

### 2.3 TaxReturnWorkStatus webhooks were silently dropped
The handler logged "will sync on next full sync" and did nothing — and the full sync wasn't running (2.1), so ProConnect work-status changes never reached the Hub.

### 2.4 Organization auto-linking was dead code
The `auto_link_proconnect_to_hub` DB trigger matched `client_type = 'BUSINESS'`, but every sync path writes `'ORGANIZATION'`. Of 569 organization clients, only 248 were linked (all via the separate fuzzy matcher). Confirmed against the live function definition.

### 2.5 `efile_status` extraction bug
`lib/proconnect/sync.ts` read a top-level `eng.efileStatus` that doesn't exist; the real value lives in `taxFiling.filings[].filingStatuses[]` (only the `proconnect-sync-engagements` edge function extracted it correctly).

### 2.6 Broader platform noise (not ProConnect-specific)
The duplicate `v0-motta-hub` Vercel project runs the same `vercel.json` crons **without env vars**, producing ~1,900 runtime errors/week (`ignition-sync`, `zoom-link-sweep`, `debrief-reminder`, `meeting-summary-ingest`, `daily-briefing`, `tommy-*`). These crons fail on the duplicate project daily; the same crons on `mottahub` are what actually run.

### 2.7 Hardcoded project URLs in edge functions
`proconnect-sync-clients`, `-engagements`, `-custom-statuses` hardcoded `https://gylupzxitoebhqjnvzuw.supabase.co/...` for the refresh-token call instead of using the auto-injected `SUPABASE_URL`.

## 3. What this branch fixes

1. **Nightly sync rebuilt** (`app/api/cron/proconnect-sync/route.ts`): now runs a **bulk sync inline on Vercel** (`runBulkSync` in `lib/proconnect/sync.ts`) — one `/v1/clients` call, one `/v2/engagements?period={year}` call per tax year (2021→current), one custom-status call. ~8 API calls total (the old per-client loop was ~12,000, which is why it had been pushed to a never-deployed edge function). Retries 429/5xx with backoff; writes `proconnect_sync_logs`; keeps the 3-strike Resend alert.
2. **Client webhooks fixed**: `syncSingleClient` now pulls the client list and filters by id (matching both `oiiClientId` and top-level `id.value`); the webhook route fetches the list **at most once per delivery**, eliminating the 429 storms. Client rows now also carry `client_type`, `client_state`, phone/address/tax-id fields (previously only the edge function wrote those).
3. **TaxReturnWorkStatus webhooks implemented**: resolves the engagement, refreshes that client+year's engagements (one API call) so status changes appear immediately.
4. **Org auto-link trigger fixed** (`scripts/348_fix_proconnect_org_autolink.sql`): accepts `'ORGANIZATION'` (and legacy `'BUSINESS'`). **Already applied to the live database** as migration `fix_proconnect_org_autolink`.
5. **`efile_status` extracted correctly** from `taxFiling.filings[].filingStatuses[]` (latest by date) in the new bulk path.
6. **ALFRED can now answer tax questions**: `lib/alfred/allowed-tables.ts` allow-lists `proconnect_engagements_enriched`, `proconnect_custom_statuses`, `proconnect_sync_logs`, and `tax_return_links_enriched` with accurate column hints (verified against the live schema). `proconnect_clients` is deliberately **excluded** — its `tax_id` column holds SSNs/EINs.
7. **Env-var resilience**: ProConnect cron/webhook/sync code falls back to `NEXT_PUBLIC_SUPABASE_URL` when `SUPABASE_URL` is unset, and edge functions build the refresh URL from `SUPABASE_URL` instead of a hardcoded project ref.

## 4. Remaining ops actions (cannot be done from code)

1. **Deduplicate the Vercel projects.** `v0-motta-hub` and `mottahub` both build this repo and both register the `vercel.json` crons. Either delete/pause `v0-motta-hub`, disconnect it from the repo, or copy the full env set to it. Until then it will keep erroring daily (and if you ever *do* add env vars to it, crons will double-run — worse).
2. **Confirm `PROCONNECT_WEBHOOK_VERIFIER_TOKEN` is set on `mottahub`.** The webhook route verifies Intuit's HMAC when the var is present but **fails open** (processes unverified) when it's absent.
3. **After merge, run a manual sync** to backfill the ~7 weeks of stale client data: `POST /api/cron/proconnect-sync` with `Authorization: Bearer $CRON_SECRET` (or use the Full Import card at `/tax/settings`).
4. **Optional cleanup on Supabase:** ~10 one-off `proconnect-investigate-*` / `-test-*` / `-diff-*` edge functions are still deployed (several with JWT verification off). Delete the ones no longer needed.
5. **Token hygiene:** the refresh token (100-day rolling) is now exercised daily by the nightly sync; watch `proconnect_oauth_tokens.last_refresh_error` on `/tax/settings`.

## 5. Capability map vs. the ProConnect Open API docs (Phase 0 + Phase 1)

| API capability | Status in Hub |
|---|---|
| OAuth (authorize / refresh / revoke), scope `com.intuit.proconnect.taxreturns` | ✅ Working (`/api/proconnect/oauth/*`, singleton token row) |
| `GET /v1/clients` (Clients) | ✅ Nightly bulk sync + webhook resolution |
| `GET /v2/engagements?period=` (Engagements) | ✅ Nightly per-year bulk sync (incl. e-file status) |
| `GET /v1/custom-status` | ✅ Nightly |
| Webhooks: Client / TaxReturn / TaxReturnWorkStatus, HMAC via `intuit-signature` | ✅ All three handled (was: Client failing, WorkStatus dropped) |
| Phase 1 return-data **export** (`GET /v2/clients/{c}/returns/{r}/data`) | ✅ API + snapshot tables + webhook-driven refresh (no UI yet) |
| Phase 1 return-data **import/write-back** (`POST .../import/series/{s}`) | ⚠️ API + audit tables exist (`/api/proconnect/returns/[returnId]/import/[seriesId]`), no UI; use with care |
| Engagement **creation** (`POST /v2/clients/oii-client/{id}/returns`) | ❌ Not built — candidate next step for the intake → engagement flow (`prospect_submissions.proconnect_push_status` already exists) |
| Line-item ingest / PDF generation / e-file triggering | 🚫 Not supported by the ProConnect API (per docs) |

## 6. ALFRED integration summary

ALFRED (the Claude-powered assistant at `alfred.motta.cpa` / `/api/alfred/chat`) reads the Hub DB through the `lib/alfred/allowed-tables.ts` allow-list. With this branch it can answer, via `queryDatabase`/`searchAcrossTables`:

- "Where is *client*'s 2025 1040?" → `proconnect_engagements_enriched` (status, e-file status, custom status, preparer)
- "How many returns does *preparer* have in Review?" → same view, grouped
- "Is *client*'s return billed / has a Karbon work item?" → `tax_return_links_enriched`
- "Is tax data fresh?" → `proconnect_sync_logs`

No new ALFRED tools were required — the existing generic DB tools pick up allow-listed tables automatically (they're embedded into the system prompt from this file).
