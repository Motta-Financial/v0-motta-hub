# ProConnect Series Map Import — remaining work (handoff)

**Written:** 2026-08-07 · **Revised:** 2026-08-07, after the write path was
proven end to end through the UI.
**Purpose:** each section is self-contained. Paste one into a fresh chat and it
should be workable without the others.

## Shared context (include this in any of the chats below)

Intuit ProConnect Phase 1 gives two Data Service endpoints — **Export** (read a
1040's full field data) and **Import** (write field values back). Both work, in
production, from the UI.

**They are asymmetric, and this cost us weeks twice:**

| | Host | Path |
|---|---|---|
| Export | `protaxdata.api.intuit.com` | `GET /v2/clients/oii-client/{clientId}/returns/{returnId}/data` |
| Import | `protaxonlineimport.api.intuit.com` | `POST /v2/clients/{clientId}/returns/{returnId}/import/series/{seriesId}` |

Export needs the `oii-client/` segment; Import does **not**, and Import has its
own host (v3 doc §3). Measured 2×2 on the sentinel 2026-08-07: only
*import host + no `oii-client/`* returns 200; the other three combinations 403.

**The 403 rule:** a wrong host or wrong path returns `403 AuthorizationFailed`,
byte-identical to a genuine provisioning failure. **A 403 on this gateway proves
nothing.** Check host and path before ever concluding "not provisioned." We are
provisioned (realm redacted — public repo).

**The sentinel return** — the only return anything may be written to:

```
returnId  de74b2b2-ab40-4867-8a2a-d52f1518c58d
clientId  (redacted — public repo; query proconnect_return_snapshots
           for proconnect_client_id where return_id = de74b2b2-…)
name      SENTINEL TEST — DO NOT FILE
TY2025, type IND
```

⚠️ **The sentinel is permanently dirty.** The probe text
`RETEST 20260807 DEFECT PROBE` sits at disposition instance 25 (`s52/p25/c800`)
and **cannot be removed** — that's defect 3. Refresh
`scripts/.sentinel-baseline-de74b2b2-*.json` before using this return for
sentinel-diff field labeling, or that cell reads as a real mapping.

**Key files**
- `lib/proconnect/data.ts` — `exportReturnData()`, `importSeries()`, `verifyEntriesLanded()`, the two host constants
- `app/api/proconnect/returns/[returnId]/import/[seriesId]/route.ts` — Import route (leadership-gated, allowlist, 30-min dryRun-before-commit window, post-write verification)
- `app/api/proconnect/returns/imports/route.ts` — import audit-log query
- `components/tax/field-edit-sheet.tsx` — the single-field write UI
- `scripts/376-retest-intuit-import-defects.ts` — survey/probe/write/clear/selftest harness
- `skills/proconnect-1040-mapping/SKILL.md` — field model, code dictionary, defect list

**Prod state, end of 2026-08-07**
- `proconnect_return_snapshots`: 35+ rows — Export solid
- `proconnect_import_jobs`: 15 rows — 7 dry runs, 8 commits, 2 of them `partial`
- `PROCONNECT_WRITE_ALLOWED_RETURN_IDS`: set in Production + Preview, sentinel only
- Host base URLs are **not** set as env vars in any environment, deliberately — see §5

---

# DONE 2026-08-07 — close these in Karbon

- **Identify test 1040 return** — the sentinel, above
- **Manually call Export API** / **Store raw Export response**
- **Manually call Import API in dry-run mode** — job `7f717e35`, s52, HTTP 200, clean summary, nothing persisted
- **Manually call Import API in commit mode** — first write ever at 08:46:17 UTC (`s52/p25/c800`, `importedCount 1`, new series version); first via the Hub route as job `68cc172d`
- **Verify write via Export re-pull** — confirmed, and now automated (see the verification note below)
- **Retest Intuit's four import-API bugs** — results below
- **Build Export / Import Edge Function** — built as Next.js routes, accepted deviation, both exercised
- **Build v0 frontend for return read/write** — shipped in #332, fixed in #333, verified through the UI at 11:18:59 UTC

**Defect results (sentinel, 2026-08-07)**

| # | Defect | Status | Evidence |
|---|---|---|---|
| 1 | 20-instance disposition cap | ✅ Fixed | 25 instances (`s52` p1–p25) dry-ran clean; commit at p25 returned `importedCount: 1` |
| 2 | M-screens not importable | ✅ Fixed | Echoing a real populated M cell (`s200M/p0/c11/x1000`) back as a dry run returned `totalImported 1 / totalErrors 0`. The remaining M problem is a **catalog-delivery gap**, not an API bug — see §1 |
| 3 | No delete/clear | 🟡 Acknowledged by Intuit, in progress (2026-08-19) | Five clear shapes tried, all left the value untouched. Intuit confirmed they're actively working on delete/clear support but have not committed to a scope or date — still treat as unavailable until they ship something and we retest |
| 4 | `isDetailImport` not set on API writes | ❌ Still open | API-written cell came back with no `importSource` key. Other channels *do* populate it on this same return (`isDocImport` 49, `isCalculated` 29, default 22), so the flag is absent specifically for API writes |

**Defect 3 fails silently as success** — the single most important operational
fact here. Every clear attempt returned `{"totalImported":1,"totalErrors":0}`
**and bumped the series version**, with the value unchanged.

So the Import route no longer believes Intuit. After every commit it re-exports
and diffs each entry against the return (`verifyEntriesLanded()`), classifying
misses as `absent` / `value_mismatch` / `clear_ignored`, and marks the job
**`partial`** — never `succeeded` — when anything didn't land. Proven end to end
through the UI: job `d7abac42`, `checked 1 / landed 0`, `clear_ignored`,
`request_version dc5a7dc0…` → `response_version c9d546c0…` on a write that
changed nothing.

**Never treat `importedCount`, `totalErrors: 0`, or a version bump as proof a
write applied.** Only a value-level diff of a fresh Export is.

---

# 1. Back to Intuit — next call

1. **Defect 3 (no delete/clear)** — Intuit has acknowledged this (2026-08-19)
   and said they're actively working on it, but haven't committed to a scope
   or timeline ("still figuring out how far we are going to take it"). Until
   they ship something, it's still worse than "unsupported": it reports
   success and bumps the version. Follow up periodically for scope/ETA, and
   when they do ship something, retest with `376-retest-intuit-import-defects.ts`
   before trusting it — don't assume it covers every field type or write path
   just because they say it's done.
2. **Defect 4 (`isDetailImport`)** — still open. Bring the baseline: other
   channels populate `importSource` on the same return, so this is specific to
   API writes.
3. **M-series catalog delivery gap** — the API accepts M-series writes now, but
   the catalog they supplied has **zero** M-series rows (748 Federal series, all
   `^s\d+$`) while live returns carry them. Ask for the M-series codes. This is
   a delivery problem, not a defect.
4. Optional: whether ProConnect reads are metered (Core vs. metered CorePlus),
   still unconfirmed and relevant before scaling Export polling.

---

# 2. Line 26 and line 25b — one schema change, not two

Both are blocked on the same limitation: `form_1040_proconnect_map` holds **one
code per line**, and both of these lines must sum several codes.

- **Line 26, estimated payments.** Codes known — `s5400` amount-paid `c2`=Q1,
  `c4`=Q2, `c6`=Q3, `c8`=Q4 (`scripts/369_form_1040_sentinel_round2_ty2025.sql:8`).
  Mapped: Q1 only.
- **Line 25b, other withholding.** Mapped: `s12/*/c14` = "Federal income tax
  withheld" on Interest Income (1099-INT / 1099-OID), aggregated across
  instances. Missing: withholding from 1099-R (series `s14`) and 1099-MISC, so
  25b understates on any return carrying those.

The fix is either extending the `*` wildcard aggregate mechanism used for
multiple W-2s (commit `8d46511`) to span series, or adding a multi-code row
type. Discovery is done; this is schema work.

**Also still open, but waiting on data, not on us:** filing-status codes 1
(Single), 3 (MFS) and 5 (QSS) are `inferred`; only 2 (MFJ) and 4 (HOH) are
`confirmed`. A real return with each status confirms them — check when one syncs.

---

# 3. 1040 viewer vs ProConnect — coverage verification

**Karbon:** "1040 viewer vs PC". Independent of the Import work.

The task comment says 28 field mappings; it's **34** now (line 6c via PR #305,
dependent Type enum via #306). Coverage tooling:
`scripts/371-audit-1040-map-coverage.mjs`.

Compare what the viewer renders against the real return, line by line.
Constraint: **the API exposes no calculated values**, only input cells. Lines
12a, 6b, 16, 19 are estimated in our code; others are marked N/A. Verify anything
computed against a **filed PDF**, not the API.

---

# 4. Karbon board hygiene

Three sub-items are marked Completed on the board that describe an architecture
this build abandoned: a Data Service base URL as a **Supabase Edge Function
secret**, a deployed `proconnect-test-export` Edge Function, and the
`proconnect_export_raw` landing table.

None of it is live. `supabase/functions/` holds only the five sync/token
functions; Export and Import are Next.js routes over `lib/proconnect/data.ts`;
and `proconnect_export_raw` held 0 rows and is dropped by
`scripts/377_drop_proconnect_export_raw.sql`. Correct the board so nobody builds
against it, and delete the Edge Function if it is still deployed in Supabase —
that one can't be checked from the repo.

---

# 5. Standing decisions worth not re-litigating

- **Do not set `PROCONNECT_IMPORT_BASE_URL` or `PROCONNECT_TAX_RETURNS_BASE_URL`
  in Vercel.** Neither is set in any environment; both defaults are verified
  against live 200s. Overriding one creates a second source of truth that can
  drift, and drift surfaces as a 403 indistinguishable from deprovisioning —
  the exact trap that cost weeks twice. Set them only if Intuit moves a host.
- **`PROCONNECT_WRITE_ALLOWED_RETURN_IDS` fails closed.** Unset means no return
  may be committed to. It currently holds the sentinel and nothing else.
  Widening it is the one change that makes real client returns writable.
- **The five `succeeded` commit rows from 08:47 UTC are false.** They predate
  verification and were all no-op clears. Anyone auditing
  `proconnect_import_jobs` should read anything before 10:00 UTC on 2026-08-07
  as unverified.
