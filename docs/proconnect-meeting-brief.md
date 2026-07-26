# ProConnect Open API — Integration Status & Provisioning Request

**Firm:** Motta Financial · **Realm / Company ID:** `9130356180193146`
**Scope granted:** `com.intuit.proconnect.taxreturns` · **Source:** `ITO`
**Prepared:** 2026-07-26 — every figure below is a live query against production.

---

## 1. One-paragraph summary

We have built and deployed a full ProConnect integration into the ALFRED
Hub, our practice-management platform. **The platform services work
exactly as documented** — OAuth, Client Service, Engagement Service, and
Custom Status are all in production, syncing 2,253 clients and 908 tax
returns nightly in 13 seconds, with 5,659 real-time webhook events
processed. **The one thing that does not work is the Phase 1 Data Service
(Export/Import).** Every call returns HTTP 403 while the same token
successfully reads Client and Engagement data. We believe our app is not
provisioned for the Data Service endpoints, and that is the single
blocker standing between us and the return-data features we've already
built the UI for.

---

## 2. What is live in production today

| Capability | Endpoint | Status | Evidence |
|---|---|---|---|
| OAuth 2.0 (auth-code + rotating refresh) | `appcenter` / `oauth.platform` | ✅ Live | Token auto-refreshes on demand; zero auth failures since May |
| Client Service | `GET /v1/clients` | ✅ Live | **2,253 clients** (1,599 individuals, 654 organizations) |
| Engagement Service | `GET /v2/engagements?source=ITO&period=…` | ✅ Live | **908 returns**, tax years 2019–2025, all 7 return types |
| Custom Status | `GET /v1/custom-status?source=ITO` | ✅ Live | 40-status catalog synced; 15 in active use |
| Webhooks — Client | push | ✅ Live | 2,161 events received |
| Webhooks — TaxReturn | push | ✅ Live | 3,498 events received (Create/Update/Delete) |
| Nightly full sync | bulk | ✅ Live | **2,014 clients + 800 engagements in 13s**, 6/6 consecutive nights |
| **Data Service — Export** | `GET /v2/clients/{clientId}/returns/{returnId}/data` | ❌ **403** | **0 snapshots ever**, 72 failures, latest today 09:18 UTC |
| **Data Service — Import** | `POST …/import/series/{seriesId}` | ⛔ Untested | Cannot validate — Export must work first |

### Return mix synced (proves breadth, not just a happy path)

| Form | Returns | Clients |
|---|---:|---:|
| 1040 (IND) | 687 | 325 |
| 1120S (SCO) | 109 | 57 |
| 1065 (PAR) | 82 | 47 |
| 990 (EXM) | 15 | 5 |
| 1120 (COR) | 13 | 6 |
| 709 (GFT) | 1 | 1 |
| 1041 (FID) | 1 | 1 |

### What we built on top

- **Client identity bridge** — ProConnect clients reconciled against our
  Hub contacts/organizations, with database-level uniqueness so one PTO
  client can never map to two internal records.
- **Tax dashboard** — 908 returns filterable by form, year, preparer, and
  your custom statuses; all facets computed in a single query.
- **Form 1040 viewer** — built and deployed, mapping series/prefix/code/
  suffix cells to 1040 line numbers, with TY2025 OBBBA constants
  (standard deduction 15,750 / 31,500 / 23,625; CTC 2,200). The form's
  line structure and constants are seeded; **the code→line map is empty
  because we've never been able to Export a return to discover it.**
  Unblocking Export is necessary but not sufficient — we then have to
  observe which series/codes populate and seed the map (see §5). This is
  precisely why the catalog ask matters.
- **Import pipeline** — dryRun-first enforced in code (a commit is
  refused unless a clean dryRun ran in the same session), leadership-role
  gated, with a PII-redacted audit log keyed on `intuit-tid`.
- **Rate limiting** — client-side token bucket at 5 TPS with exponential
  backoff and `Retry-After` honored.

---

## 3. The blocker: Data Service returns 403

### What we observe

Every `GET /v2/clients/{clientId}/returns/{returnId}/data` call returns
**HTTP 403**. This has never once succeeded — `proconnect_return_snapshots`
and `proconnect_return_field_cells` are both empty after months of
attempts. Most recent failure: **2026-07-26 09:18:05 UTC**, 72 recorded
against TaxReturn webhook deliveries.

### Why we've concluded this is provisioning, not our code

1. **The same access token succeeds on other services.** Client Service
   and Engagement Service return 200 with that identical bearer token,
   minutes apart, on the same realm. So the token is valid and the firm
   relationship is intact.
2. **The 403 is unattributed.** Per the Phase 1 contract, Export has
   exactly two documented 403 conditions: `RETURN_LOCKED` and
   `ACCESS_DENIED`. The bodies we receive carry **neither** `errorCode`.
   An unattributed 403 is what we'd expect if the app simply isn't
   entitled to the endpoint.
3. **It is not a lock.** We reproduce it against returns whose
   Engagement response reports `lockInfo.locked = false`.
4. **It is not ownership.** The `clientId`/`returnId` pairs come straight
   out of your own Engagement Service responses for our realm — we are
   not constructing or guessing identifiers.
5. **It is not the client-id gotcha.** We hold both identifiers per
   client and use the numeric `id_client` for Export/Import paths, not
   `oiiClientId`.
6. **It fails uniformly**, across every return, client, form type, and
   tax year — not intermittently, which rules out rate limiting or
   transient faults.

### Live reproduction (we can run this on the call)

```
GET https://hub.motta.cpa/api/proconnect/returns/{returnId}/data
      ?clientId={numericClientId}&fresh=true
```

Returns Intuit's raw response body verbatim plus the `intuit-tid`
correlation ID. Known-unlocked TY2025 1040 pairs staged for the demo:

| returnId | clientId (numeric `id_client`) |
|---|---|
| `229f3018-edb3-477e-803e-138e3cbe439e` | `9341453230983859` |
| `e763811b-6219-41e6-84a4-d9e34eef7086` | `9130357916534516` |
| `71d88998-5044-490e-8d3d-7541cf0d5d58` | `9341457318450177` |

We also have `/api/tax/proconnect-status`, a diagnostics endpoint that
reports Phase 1 health, snapshot count, 7-day failure count, and the last
error — currently `status: "blocked"`.

### 🔴 The ask

**Please provision / allow-list realm `9130356180193146` for the Phase 1
Data Service Export and Import endpoints.**

If provisioning is already in place from your side, we'd like to work
through one live 403 together and capture the `intuit-tid` so your team
can trace it. Two things would also help us confirm our configuration:

- **Confirm the correct Data Service base URL.** We have
  `PROCONNECT_DATA_BASE_URL` set to the Data Service host, but this is the
  one base URL we've never been able to verify against documentation —
  the Phase 1 spec documents paths against an abstract
  `{production-base-url}`. If we're pointed at the wrong host, that alone
  could produce these 403s, and we'd rather rule it out.
- **Confirm whether Export requires a re-consent** after the scope is
  enabled, so we know whether to have our Primary Admin re-authorize.

---

## 4. Two other issues we're tracking

### A. `TaxReturnWorkStatus` webhooks have never been delivered

Client and TaxReturn webhooks both work. `TaxReturnWorkStatus` has
delivered **zero events, ever** — not one row in 5,659 received. Our
receiver handles the entity type and would record it.

Meanwhile the *polled* custom status works fine (40-status catalog, 15 in
use, and `customStatus` is present on all 908 engagements), so we can see
status values — we just can't react to changes in real time and instead
re-poll nightly.

**Question:** does `TaxReturnWorkStatus` require a separate subscription
or entitlement, or should it arrive on the same registration as Client
and TaxReturn?

### B. `taxFiling.filings[]` is always empty — no e-file status

All 908 engagement responses include the `taxFiling` key, but **zero**
have a non-empty `filings[]` array. Same for `esignature.envelopes[]` —
present on all 908, populated on none. Per the contract, `filings[]`
should carry `filingStatuses[]` with `status` (e.g. `PENDING_AGENCY`,
`PENDING_EFE`), `confirmationNumber`, and `userMessage`.

This includes returns we know have been filed, so we cannot surface
e-file status in the Hub and staff still check ProConnect directly.

**Question:** is e-file status exposed somewhere other than the
Engagement response, does it require an additional scope, or is
`filings[]` populated only under conditions we're not meeting?

---

## 5. Where we're headed once unblocked

Our roadmap has three layers. **Layer A (plumbing) is done** — that's
everything in §2. Layer C is the goal that made us invest in this API.

- **Layer B — the field catalog.** Import writes to addresses like
  `s11/p0/c43/x1000`, but the partner documentation doesn't include the
  catalog defining what `c43` *means*. We will not guess a code mapping —
  guessing risks writing a real value to the wrong line of a real return,
  and there is no sandbox. Our fallback is to bootstrap a partial catalog
  by Exporting manually-prepared reference returns and recording which
  codes populate. **This also depends on Export working.**
  → *Secondary ask: can Intuit share the IVCS/FRF tax-content catalog, or
  a subset for 1040 TY2025?*
- **Layer C — document-to-return automation.** Our assistant reads a
  W-2/1099/K-1, maps values to codes, runs a dryRun, and imports on
  approval. First proof case is deliberately small: single filer, one
  W-2, standard deduction.

---

## 6. Talking points

1. **Lead with what works.** 2,253 clients, 908 returns, 5,659 webhook
   events, 13-second nightly sync, 6/6 nights clean. This is a working,
   production integration — not a prototype.
2. **The blocker is one specific service.** Client, Engagement, and
   Custom Status all return 200. Only the Data Service 403s, with the
   same token, on the same realm, minutes apart.
3. **We've ruled out our side.** Not a lock, not ownership, not the
   client-id gotcha, not rate limiting — and the 403 carries neither
   documented `errorCode`.
4. **We built the UI in advance.** The 1040 viewer is deployed and
   renders empty. This is ready to light up the moment Export returns 200.
5. **The ask is narrow:** provision realm `9130356180193146` for Phase 1
   Data Service, and confirm the Data Service base URL.
6. **Have the repro ready.** Offer to run the live call and hand over the
   `intuit-tid` so their team can trace it server-side.

---

## Appendix — resolved issues (evidence the integration is maintained)

Both were our bugs. We found and fixed them; neither is an open ask.

| Issue | Volume | Resolved |
|---|---|---|
| `Client` webhook 404 — we called single-client fetch in a form the API doesn't support | 1,933 events | Fixed; last failure **2026-07-10**, none in 16 days |
| `Client` 429 rate-limited — insufficient client-side throttling | 326 events | Fixed with a 5 TPS token bucket; last **2026-06-29** |

Current webhook success rate since those fixes: **100%** on Client and
TaxReturn, excluding the 403-driven export failures that are the subject
of §3.
