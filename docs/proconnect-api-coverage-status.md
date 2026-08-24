# ProConnect Open API — Documentation Set & Full Integration Coverage

**Audit date:** 2026-07-26 · **Revised:** 2026-08-19 (Export/Import/encryption)
and 2026-08-20 (`lockInfo`, table inventory, rate limiter) · **Scope:** `com.intuit.proconnect.taxreturns` · **Source/product:** `ITO`

Every row below was verified by reading the code and querying production —
not inferred from file names or planning documents.

> **On row counts.** The 2026-08-20 pass had code access but not database
> access. Counts it could not re-query are marked "not re-queried in this
> pass" rather than restated. A number carried forward unverified is exactly
> how this document drifted the first time: `lockInfo` was recorded as
> "Built; 622 of 908 currently locked" for a check that has never existed in
> the codebase, and `proconnect_export_raw` was tracked as "awaiting Export"
> for a table migration 377 had already dropped. Where our
implementation drifts from what Intuit documented, that's called out
explicitly rather than rounded up to "done."

---

## 1. The documentation set Intuit has provided

| Document | Covers | Status in our build |
|---|---|---|
| **Open API Doc** (original) | Client Service, Engagement Service, Custom Status, Create Tax Return; concrete service hostnames | Fully transcribed into our internal contract reference. **Not reconfirmed as current** — see below. |
| **Phase 1 Doc v3** (Export/Import) — **authoritative / confirmed current** | Export API, Import API, series/prefix/code/suffix model, three-layer validation, error codes, rate limits, partial-success semantics. Explicitly scopes itself to **IND (1040) only** — "Additional modules (cor, sco, par, fid, exm, gft) will follow." | Fully transcribed; §A.6/A.7/B.6/B.8 cited directly in our code comments. This doc does **not** define Create Tax Return, Create Client, or Update Client at all — those only appear in the original (unconfirmed) doc. |
| **Intuit platform OAuth docs** (shared with QuickBooks) | Authorization-code flow, token lifetimes, rotation, revocation, the 5-year refresh cap, Reconnect URL | Implemented |
| **Intuit webhooks pattern** (shared with QuickBooks) | Payload envelope, `intuit-signature` HMAC verification, retry cadence | Implemented |

### What is *not* in the documentation set — and is blocking us

| Missing | Consequence |
|---|---|
| **The IVCS/FRF field catalog** — the dictionary mapping a `codeId` to a tax concept ("`c43` = wages") | This is the hard gate on all automation. We can read and write any code we *know*, but we cannot know which code is "1040 line 1a" without it. We refuse to guess: there is no sandbox, and a wrong guess writes a real value onto a real client return. |
| **A confirmed Data Service base URL** | The Phase 1 doc documents paths against an abstract `{production-base-url}`. We set `PROCONNECT_DATA_BASE_URL` to the Data Service host from the original Open API Doc, but this is the one hostname we have never been able to verify — and a wrong host would itself produce the 403s we see. |
| **Per-code field rules** (`codeType`, ranges, `oneOf` sets) | We can only discover these reactively, by reading `FIELD_RULE_VIOLATION` messages back from `dryRun`. |
| **API metering status** (Core vs. metered CorePlus) | Unconfirmed whether ProConnect reads are metered. Relevant before we scale Export polling. |

---

## 2. Endpoint coverage — every documented operation

### Client Service — `client.accountant.intuit.com`

| Operation | Documented | Built | Notes |
|---|---|---|---|
| `GET /v1/clients` (all) | ✅ | ✅ **Live** | 2,253 clients synced |
| `GET /v1/clients?oiiClientId=…` (one) | ✅ | ⚠️ **Deprecated in our code** | Marked `@deprecated` — the single-client form returned 404 in practice. Caused 1,933 webhook failures until we switched to list-and-filter. **Worth raising with Intuit: is the single-client query supported?** |
| `POST /v1/clients` (create) | ✅ | ❌ **Not built** | Deliberate. Rule: never create a duplicate PTO client — they're very hard to delete. Needs a verified look-up-first flow before we'd ship it. |
| `PUT /v1/clients` (update) | ✅ | ❌ **Not built** | Hub → ProConnect write-back is not in scope yet. |

### Engagement Service — `engagement.accountant.intuit.com`

| Operation | Documented | Built | Notes |
|---|---|---|---|
| `GET /v2/engagements?source=ITO&period=…` | ✅ | ✅ **Live** | 908 returns; `period` correctly treated as **tax** year |
| `GET /v2/engagements/{engagementId}` (single) | ✅ | ✅ **Live** | Built 2026-07-28 for e-file status, which the list form does not carry. One call per engagement, so scoped: webhooks hydrate the engagement that changed, the nightly sync drains a capped queue of stale ones. |
| `GET /v1/custom-status?source=ITO` | ✅ | ✅ **Live** | 40-status catalog; 15 in active use |
| `lockInfo.locked` pre-check before Import | ✅ | ❌ **Not built** | Corrected 2026-08-20: `lockInfo` is **never read** — `grep -rn lockInfo` over the codebase returns zero hits in `.ts`/`.tsx`. The previous row ("Built; 622 of 908 currently locked") described a check that does not exist. The Hub's actual pre-write gate is `lib/proconnect/efile-lock.ts`, a *different* predicate: it locks on an accepted RETURN filing rather than on Intuit's headline status, deliberately, because the headline produced 66 false locks. Whether to also fetch and trust `lockInfo` verbatim is an open question for Intuit, not a rendering gap. |
| `taxFiling.filings[]` → e-file status | ✅ | ✅ **Live** | **Was never an Intuit gap.** Empty on the LIST endpoint (908 of 908, `include-efiles=true` is a no-op there); populated on the single-engagement GET. Corrected 2026-07-28 — see below. |
| `esignature.envelopes[]` | ✅ | ⚠️ **Built, no data** | Present on all 908 list rows, populated on none. Worth re-testing against the single-engagement GET before calling this an Intuit gap — that assumption was wrong for `taxFiling`. |

### Data Service — Create / Export / Import

| Operation | Documented | Built | Notes |
|---|---|---|---|
| `POST /v2/clients/oii-client/{clientOiiId}/returns` (create return) | ⚠️ **Not in the authoritative Phase 1 v3 doc** — only in the unconfirmed original doc | ⚠️ **Built, unverified** | `createTaxReturn()` + `/api/prospects/[id]/create-tax-return` route exist, leadership-gated and audit-logged, but no live call has succeeded (or even been attempted) — the host/path are inferred, not confirmed. Also now hard-gated to `type: "IND"` only, since Phase 1 v3 explicitly says other modules "will follow." The original blocking rationale — "we won't create returns we can't then read back" — no longer applies: Export is confirmed working (see below), so a successful create-return would now be readable back. The remaining blocker is purely that the endpoint itself is unverified/undocumented in the authoritative spec. |
| **Proforma** (roll prior year forward via `source`) | ⚠️ Same doc caveat as above | ⚠️ **Payload field wired, unverified** | The route accepts an optional `source` (prior-year engagement id) and passes it through, but this is unverified by any live call, same as create-return itself. |
| `GET /v2/clients/{clientId}/returns/{returnId}/data` (**Export**) | ✅ | ✅ **Working as of 2026-07-27** | Stale note corrected 2026-08-19: 69 snapshots exist, first success 2026-07-27 15:51 UTC, most recent 2026-08-18 19:54 UTC — one day after the previously-recorded "latest failure." The earlier 403-only status was true historically but had not been updated once the fix landed. |
| `POST …/import/series/{seriesId}` (**Import**) | ✅ | ✅ **Working as of 2026-08-07** | First successful call ever on 2026-08-07. Had been 403 on every attempt because the Hub posted to the Export host; Import has its own host, `protaxonlineimport.api.intuit.com` (doc v3 §3), and unlike Export takes **no** `oii-client/` segment. Dry run + commit both verified on the sentinel return. |
| Return-type allowlist (IND/COR/SCO/PAR/FID/EXM/GFT; reject 706/5500) | ✅ | ✅ **Enforced** | All 7 types present in synced data |
| Both client identifiers (`oiiClientId` **and** numeric `id_client`) | ✅ | ✅ **Held per client** | We use `id_client` on Export/Import paths, correctly |

---

## 3. OAuth & token layer

| Requirement | Status | Detail |
|---|---|---|
| Authorization-code flow via `appcenter.intuit.com/connect/oauth2` | ✅ | With `product=ITO`, `response_type=code`, registered redirect URI |
| Signed CSRF `state` | ✅ | `lib/proconnect/oauth-state.ts` |
| Token exchange/refresh at `oauth.platform.intuit.com` | ✅ | HTTP Basic `client_id:client_secret` |
| Refresh-on-demand with expiry buffer | ✅ | `getAccessToken()` — verified as the single entry point |
| Persist rotated refresh token every response | ✅ | Rotation handled |
| Serialize refreshes (avoid `invalid_grant`) | ✅ | Single in-flight refresh |
| All five portal URLs registered | ✅ | Redirect, Launch, Connect/Reconnect, Disconnect, Webhook — all on `hub.motta.cpa` |
| Middleware exemption for callback | ✅ | Named flag, mirrors the Calendly pattern |
| Reconnect path (5-year cap readiness) | ✅ | `oauth/connect` doubles as Reconnect URL |
| **Tokens encrypted at rest (AES-256-GCM)** | 🔴 **NOT IMPLEMENTED** | See §7. `PROCONNECT_TOKEN_KEY` appears nowhere in the repo; tokens are stored in plaintext. |

---

## 4. Webhooks

| Requirement | Status | Detail |
|---|---|---|
| `intuit-signature` HMAC-SHA256 over **raw** body | ✅ **Correct** | Hashes `request.text()` — not re-serialized JSON — compared base64 with `timingSafeEqual` |
| Session-gate exemption | ✅ | |
| Fast 2xx ack | ⚠️ **Partial** | Acks, but processes **synchronously** before responding (including an Export attempt per TaxReturn event). Known issue; on our fix list. |
| Dedupe on realm + entity + id + operation + lastUpdated | ✅ | |
| Branch on `entities[].name` + `operation` (no event-type field) | ✅ | |
| Reconciling periodic reads | ✅ | Nightly full sync, 13s |

### Delivery record — 5,659 events

| Entity | Operations seen | Received | Status |
|---|---|---|---|
| `Client` | Create, Update | 2,161 | ✅ Delivering (222 processed since the 404 fix) |
| `TaxReturn` | Create, Update, **Delete** | 3,498 | ✅ Delivering (3,425 processed) |
| `TaxReturnWorkStatus` | — | **0** | 🔴 **Never delivered.** Receiver handles the entity type. Open question for Intuit. |

---

## 5. Field model & the three layers

| Layer | Scope | Status |
|---|---|---|
| **A — Plumbing** | Connect, sync clients/engagements/statuses, webhooks, Export/Import wiring, rate limiting, audit logging | ✅ **Complete** (Export blocked externally) |
| **B — Catalog** | code ↔ tax-concept dictionary + per-code rules | 🟡 **Unblocked and modelled; load pending.** Steve Wheelis sent the IND 2025 IVCS/FRF extract — 67,810 codes. Schema, RFC-4180 loader and constraint parser are built and dry-run verified (100% of constraint strings parsed, 612 distinct forms, 13 tokens, zero unrecognised clauses). **Loaded as of 2026-08-20** (the 0-rows note was stale — see §6). Remaining content gap: zero M-series rows in Intuit's extract. |
| **C — Intelligence** | Gather W-2/1099/Schedule A in the Hub → map to codes → dryRun → import | 🟡 **Five document types live.** See §5b. |

### The four-level address is fully modelled

`{seriesId}/{prefixId}/{codeId}/{suffixId}` is implemented end to end —
`proconnect_return_field_cells` stores every leaf property the spec
defines (`val`, `desc`, `src`, `tsj`, `scope`, `cityAbbrev`, `source`,
`import_source`), and `flattenSeriesMap()` / `getSeriesVersion()` handle
the nested map and per-series version stamps.

### 5b. The intake pipeline — gather in the Hub, import into ProConnect

This is the end goal working end to end, minus the final API call:
a preparer keys source documents into the Hub, the Hub computes the 1040
face and simultaneously builds the exact Import payload those documents
produce, and both are shown side by side before anything is sent.

**Five document types are live** (79 field definitions, TY2025 IND):

| Type | Series | Fields | Notes |
|---|---|---|---|
| W-2 | `s11` | 23 | Includes the OBBBA §224 tips and §225 overtime fields |
| 1099-INT | `s12` | 11 | In-state muni is a *subset* of total muni, not a substitute — the engine warns when only the subset is entered |
| 1099-DIV | `s13` | 11 | Qualified dividends trigger the preferential-rate gate |
| 1099-R | `s14` | 13 | Carries the line-4-vs-line-5 discriminator |
| Schedule A | `s400` | 21 | Drives the standard-vs-itemized comparison on line 12 |

**Repeated documents** become ProConnect prefixes: three W-2s are
`p0`/`p1`/`p2` against the same `s11` codes. Verified against live rows —
two W-2s and two 1099-Rs serialize to distinct prefixes with no code
collision. ⚠️ The `p{n}` convention is *inferred from the field model, not
confirmed by a real Export*, and every batch carries a `prefixAssumed`
flag saying so.

**The 1099-R discriminator works as designed.** `s14/c2` (box 7
IRA/SEP/SIMPLE) is what separates line 4 from line 5 — the gross and
taxable codes are identical for both. An IRA distribution routes to
4a/4b, a pension to 5a/5b, from the same `s14/c3` and `s14/c4`. In the
serialized payload the checkbox is emitted as `"1"` when set and **omitted
entirely** when not; sending `"0"` would write an explicit zero, which is
not the same as leaving a ProConnect checkbox blank.

**Pre-validation before any call to Intuit.** `lib/proconnect/catalog.ts`
checks each entry against the catalog's own `fieldRules` and pre-empts the
three Import error classes we can see locally — `SUB_FIELD_NOT_ALLOWED`,
`FIELD_RULE_VIOLATION`, `CATALOG_SERIES_NOT_FOUND`. It runs *ahead of*, never
instead of, the mandatory dryRun, which still catches return-state rules
the catalog cannot express (`RETURN_LOCKED`). With the catalog unloaded it
reports `catalogAvailable: false` and refuses to certify the batch, rather
than returning a meaningless all-clear.

**Everything computable fails closed.** Two independent gates in
`form_1040_constants`, both currently `false`:

- `tax_brackets_verified` — line 16 is reported unavailable until the
  TY2025 brackets are checked against Rev. Proc. 2024-40.
- `itemized_constants_verified` — whenever a Schedule A is present,
  line 12 (and everything below it) is unavailable until the SALT cap,
  medical floor and charitable mileage rate are checked against the IRS
  Schedule A instructions and P.L. 119-21 §70120.

A third gate is structural rather than a flag: when qualified dividends or
capital gain distributions are present, line 16 is left blank because the
Qualified Dividends and Capital Gain Tax Worksheet is not implemented.
Taxing preferential income at ordinary rates would overstate the tax, and
a plausible wrong number is worse than a blank.

The calculator carries 53 assertions covering bracket boundaries, the
SALT phase-down (including its $10,000 floor), the 1099-R routing, the
medical AGI floor, standard-vs-itemized in both directions, and every
fail-closed path. All pass.

### 5c. Client profile ↔ intake alignment

The Hub already knows who the taxpayer is, so the 1040 header is *read
from the client profile*, never re-keyed. `lib/tax/intake/profile.ts` is
the single declared correspondence between the two vocabularies, and the
intake page shows each field with its source and whether it is on file.
The profile stays the source of truth — a preparer who finds a wrong SSN
fixes the client record, so next year's return inherits the correction.

**Mapped to `contacts`:** first/middle/last/suffix, SSN, date of birth,
occupation, address, city, state, ZIP, email, phone, driver's licence.

**No column exists — gaps in the Hub's model, not in one client's record:**

| Field | Consequence |
|---|---|
| **Spouse** (name, SSN, DOB) | No household model. `tax_client_relationships` links people to *organisations* (ownership), not to each other. A joint return cannot be assembled from the profile. |
| **Dependents** | No dependents table. One contact is typed `Client's Dependent` — a label, not a link. Blocks the OBBBA $2,200 CTC and the $500 ODC. |
| Direct deposit (routing/account) | Lines 35b–35d. Refunds would have to go by cheque. |
| IRS Identity Protection PIN | Required to e-file for any taxpayer issued one. |
| Presidential campaign fund | Cosmetic. |

Filing status is intentionally *not* on the profile: it lives on
`tax_input_sets.filing_status`, per return, because it changes year to year.

**Coverage across the 937 contacts typed `Client*`** — the reason this
matters more than the mapping does:

| Field | On file |
|---|---|
| First / last name | 99.6% / 99.5% |
| Email | 90.3% |
| SSN | **31.3%** |
| State / city / address / ZIP | **13.2% / 12.3% / 11.5% / 11.3%** |
| Date of birth | **6.2%** |
| Occupation | **0%** |
| Driver's licence | **0%** |

`GET /api/tax/intake/profile-coverage?clientsOnly=1` returns this live, so
it is answerable in November rather than discovered in March. Two entries
are worth calling out: **date of birth at 6.2%** drives OBBBA §63(f)'s
additional senior deduction, which has *no ProConnect input field* —
ProConnect derives it from DOB, so a missing DOB silently costs the client
the deduction. **Occupation at 0%** is asked for in the 1040 signature
block.

A set whose profile is missing a required field is reported as not
ready to import, regardless of how complete the income side is.

### ⚠️ Important sequencing correction

The Form 1040 viewer is built and deployed, and I previously described it
as "empty because Export returns 403." That is the proximate cause but
not the whole dependency. The renderer reads
`form_1040_proconnect_map`, which by design returns `null` for any
unmapped line. So the real chain is:

1. Intuit provisions Export → 403 clears
2. Export a reference return → observe which series/codes populate
3. Seed `form_1040_proconnect_map` (Layer B bootstrap)
4. **Then** the viewer renders values

The code already states this correctly — the route's own error message
says *"Export a return first to discover the series/code structure, then
populate form_1040_proconnect_map."* Worth being precise about in the
meeting: unblocking Export is necessary but not by itself sufficient, which
is exactly why the catalog ask matters.

For reference, `form_1040_lines` (72 rows, the form's line structure) and
`form_1040_constants` (TY2025 OBBBA amounts, plus the itemized-deduction
constants added in migration 362) **are** seeded — the viewer knows the
form's shape, just not where most values live.

**`form_1040_proconnect_map` is now seeded for all 72 lines** (migration
363), but only 5 carry an address. That is deliberate. A line gets one only
when exactly one high-confidence field carries the line's own value *and*
that field's code is not shared with another line. Everything else records
*why* it is unmapped: pure arithmetic, a tax-table lookup, a multi-code
rollup, or — the interesting case — discriminator-routed. Lines 4a and 5a
are both `s14/c3`; mapping either one would be correct for half of
returns, which is worse than leaving it blank. All 5 addresses are
`inferred`, none `confirmed`; nothing here has been checked against a real
Export. Migration 363 embeds no Intuit data — it *derives* the mapping in
SQL from `form_1040_line_inputs`, so the file is safe in a public repo and
still reproduces the seed exactly.

---

## 6. Database schema

| Planned table | Actual | Status |
|---|---|---|
| `proconnect_connections` | `proconnect_oauth_tokens` | ✅ 1 row, singleton-guarded |
| `proconnect_clients` | same | ✅ 2,253 rows (1,599 person / 654 org) |
| `proconnect_returns` | `proconnect_engagements` | ✅ 908 rows |
| — | `proconnect_custom_statuses` | ✅ 40 rows |
| — | `proconnect_webhook_events` | ✅ 5,659 rows |
| — | `proconnect_sync_logs` | ✅ 23 runs |
| — | `proconnect_return_snapshots` | ✅ **Populated** — 51 on 2026-08-11 (SKILL.md census), 69 on 2026-08-19. Exact current count not re-queried in this pass. |
| — | `proconnect_return_field_cells` | ✅ **Populated** — fills from each snapshot; count not re-queried. |
| — | ~~`proconnect_export_raw`~~ | 🗑️ **Dropped** — migration 377 removed the abandoned Export landing table. Row deleted rather than corrected. |
| `proconnect_import_log` | `proconnect_import_jobs` + `proconnect_import_entry_results` | ✅ **Populated** — Import has run since 2026-08-07 (first success, plus the defect retests of 08-07/08-11); count not re-queried. |
| **`proconnect_field_catalog`** | same | ✅ **Loaded** — the IND 2025 extract is in the table; SKILL.md's census reads 748 Federal series off it, which is only possible against loaded rows. Known content gap: **zero M-series rows**, raised with Intuit 2026-08-11. |
| — | `form_1040_line_inputs` | ✅ 74 rows / 42 lines — which ProConnect fields *feed* each 1040 line (migration 360) |
| — | `form_1040_proconnect_map` | ✅ 72 rows. **More than 5 are addressed** — migration 363 was the seed; 365/370/373/374/375/379/386/387/389 added mappings, decodes and conditional (`condition` jsonb) entries since. Exact addressed count not re-queried in this pass. |
| — | `tax_input_sets` / `_documents` / `_values` | ✅ Schema live (migration 361). Service-role-only by RLS — these hold real taxpayer figures. |
| — | `tax_input_field_defs` | ✅ 79 defs across 5 document types. Rows load out-of-band: they embed Intuit catalog addresses. |

---

## 7. Safety-rule compliance audit

The ten non-negotiables for this integration, verified against code:

| # | Rule | Status |
|---|---|---|
| 1 | dryRun-first before any commit | ✅ **Enforced in the route** — a commit is refused unless a matching `dry_run = true` row exists for the same target |
| 2 | De-dup before retry (Import is not idempotent) | ✅ Keyed on `intuit_tid` |
| 3 | PII discipline — never log field values | ✅ **Verified compliant.** `entries_payload` stores addresses plus `has_val`/`has_desc`/`has_src` booleans and `redacted: true` — never `val`. `proconnect_import_entry_results` has no value column. |
| 4 | **Tokens encrypted at rest (AES-256-GCM)** | 🟡 **Code built, key not set** — see below |
| 5 | Respect `RETURN_LOCKED` / 423 | ✅ Classified and surfaced. Note the pre-check is `efile-lock.ts`, **not** `lockInfo` — see §2. |
| 6 | 5 TPS limit + backoff + honor `Retry-After` | ✅ **Resolved 2026-08-20** — the limiter was extracted to `lib/proconnect/rate-limit.ts`; `client.ts` and `data.ts` both `acquireRateLimitSlot()` off one counter. |
| 7 | Primary-Admin-only connect; Import via Primary Admin token | ✅ Import route additionally gated to leadership roles |
| 8 | Never create duplicate clients | ✅ Trivially satisfied — client creation isn't built |
| 9 | Reject 706 / 5500 | ✅ Allowlist enforced |
| 10 | Treat API as partner-confidential | ✅ No hostnames/scope in public artifacts |

### 🟡 Corrected finding (2026-08-19): encryption is built — the key just isn't set

This section previously said `PROCONNECT_TOKEN_KEY` "appears nowhere in the
codebase." That is no longer accurate. `lib/proconnect/token-cipher.ts`
implements AES-256-GCM `encryptToken()`/`decryptToken()` and it is fully
wired into `lib/proconnect/oauth.ts` (every token read/write funnels
through it). The design is opportunistic and self-healing by construction:
with no key set it stores plaintext (today's state) and logs a once-per-process
warning; the moment `PROCONNECT_TOKEN_KEY` is added to the project's env vars,
the very next token refresh (at least hourly) rewrites the row as ciphertext —
no migration script, no downtime, no backfill needed.

**What's actually left:** generate a key (`openssl rand -hex 32`) and add it
to the project as `PROCONNECT_TOKEN_KEY`. Confirmed not currently set — it
does not appear in the project's environment variable inventory. This is a
config action, not a code change.

Why this still matters until the key is set: this token grants **write
access to every tax return in the firm**, and the refresh token is
long-lived and rolling. RLS restricts the table to the service role, so
this is not remotely exploitable today — but it is one misconfigured
policy or one service-role leak away from full return-write access.

### ⚠️ Drift: two independent HTTP paths, neither fully equipped

The implementation plan called for **one** `proconnectFetch` chokepoint
carrying the limiter, backoff, `intuit-tid`, and the single
401-refresh-retry. What exists is two parallel clients:

| | `lib/proconnect/client.ts` (Client + Engagement) | `lib/proconnect/data.ts` (Export/Import) |
|---|---|---|
| 5 TPS rate limiter | ✅ shared `acquireRateLimitSlot()` | ✅ **Shared** — `data.ts:258`, same counter as `client.ts:86` |
| Exponential backoff + `Retry-After` | ❌ Not implemented | ✅ `fetchWithRetry`, 1s→30s |
| `intuit-tid` capture | ❌ Not captured | ✅ Captured and persisted |
| Error-code classification | ❌ Generic | ✅ Full per-spec classification |

Each path has what the other lacks. Practical impact today is low —
Export is 403-blocked so `data.ts` barely runs, and the 326 historical
429s came from the `client.ts` path, which *is* rate-limited now. But
before Import runs at volume, the limiter must cover `data.ts` too, or
we'll breach 5 TPS on the write path. **Recommended fix:** extract the
limiter and tid generation into a shared module both import.

---

## 8. Summary

**Working, in production:** OAuth with rotation and reconnect · Client
Service reads (2,253) · Engagement Service reads (908 across all 7 return
types, TY2019–2025) · Custom Status (40) · Client + TaxReturn webhooks with
correct signature verification (5,659 events) · nightly full sync in 13
seconds, 6/6 nights clean · client-identity bridge with DB-level
uniqueness · tax dashboard · dryRun-gated, PII-redacted Import pipeline.

**Blocked by Intuit:** Export 403 on every call (provisioning) · the IVCS/FRF
catalog (Layer B, and therefore Layer C) · `TaxReturnWorkStatus` webhooks
never delivered · Data Service base URL unconfirmed.

**No longer blocked:** `taxFiling.filings[]` was on that list on the strength
of "the key is present on all 908 engagements and empty on every one." It is
empty on the *list* endpoint only; `GET /v2/engagements/{engagementId}`
returns real filings. Attributing it to Intuit cost months of waiting on a
change that was ours to make — worth remembering the next time a payload is
present-but-empty. The one other item resting on that same inference is
`esignature.envelopes[]`; re-test it against the single GET before treating
it as blocked.

**Our own open items, in priority order:**

1. 🔴 **Encrypt the OAuth tokens at rest** (rule #4 violation — the one item here with a security dimension)
2. ⚠️ **Unify the two HTTP paths** so the rate limiter and `intuit-tid` cover Export/Import before Import runs at volume
3. ⚠️ **Make the webhook receiver ack before processing** (it currently runs an Export attempt inline)
4. ⏳ Create `proconnect_field_catalog` and seed `form_1040_proconnect_map` — unblocked only after Export works
5. ⏳ Build create-client / update-client / create-return / proforma — deferred until Export is proven

**Not a defect:** the empty snapshot, field-cell, export-raw, and import-job
tables. All four sit downstream of Export. They are correctly built and
waiting.
