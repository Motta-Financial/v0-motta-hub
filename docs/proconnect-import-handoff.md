# ProConnect Series Map Import — remaining work (handoff)

**Written:** 2026-08-07 · **Revised:** 2026-08-07 after the defect retest
**Purpose:** each section is self-contained. Paste one into a fresh chat and it
should be workable without the others.

## Shared context (include this in any of the chats below)

Intuit ProConnect Phase 1 gives two Data Service endpoints — **Export** (read a
1040's full field data) and **Import** (write field values back). Both now work.

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

⚠️ **The sentinel is now permanently dirty.** The probe text
`RETEST 20260807 DEFECT PROBE` sits at disposition instance 25 (`s52/p25/c800`)
and **cannot be removed** — that's defect 3. Refresh
`scripts/.sentinel-baseline-de74b2b2-*.json` before using this return for
sentinel-diff field labeling, or that cell reads as a real mapping.

**Key files**
- `lib/proconnect/data.ts` — `exportReturnData()`, `importSeries()`, the two host constants, error classification
- `app/api/proconnect/returns/[returnId]/import/[seriesId]/route.ts` — Import route (leadership-gated, allowlist, 30-min dryRun-before-commit window)
- `app/api/proconnect/returns/imports/route.ts` — import audit-log query
- `scripts/376-retest-intuit-import-defects.ts` — survey/probe/write/clear harness (untracked)
- `skills/proconnect-1040-mapping/SKILL.md` — field model, code dictionary, defect table
- `app/tax/returns/[returnId]/page.tsx`, `components/tax/form-1040-viewer.tsx`, `components/tax/tax-intake-client.tsx` — the UI

**Prod state**
- `proconnect_return_snapshots`: 35+ rows — Export solid
- `proconnect_import_jobs`: **7 rows** as of 2026-08-07 08:47 UTC (1 dry run, 6 commits, all 200) — Import proven end to end
- `proconnect_export_raw`: exists, **0 rows** — abandoned landing table (see §3)

---

# DONE 2026-08-07 — close these in Karbon

- **Manually call Import API in dry-run mode** — dry run at `s52`, 200, audited
- **Manually call Import API in commit mode** — commit at `s52/p25/c800`, `importedCount: 1`
- **Verify write via Export re-pull** — value confirmed present, series version bumped
- **Retest Intuit's four import-API bugs** — results below
- **Build Import Edge Function** — built as a Next.js route (accepted deviation), now exercised
- **Build Export Edge Function** — same deviation, verified since 2026-07-27
- **Identify test 1040 return** — the sentinel, above

**Defect results (sentinel, 2026-08-07)**

| # | Defect | Status | Evidence |
|---|---|---|---|
| 1 | 20-instance disposition cap | ✅ Fixed | 25 instances (`s52` p1–p25) dry-ran clean; commit at p25 returned `importedCount: 1` |
| 2 | M-screens not importable | ⚠️ Routing fixed, untestable | `s100M`/`s200M` now resolve — they answer `INVALID_CODE … not valid for series 's100M'`, same shape as the numeric control. But the catalog Intuit shipped has **zero M-series rows** (748 Federal series, all `^s\d+$`), so there is no valid M code to write. Not closeable from our side |
| 3 | No delete/clear | ❌ Still open | Five clear shapes tried, all left the value untouched |
| 4 | `isDetailImport` not set on API writes | ❌ Still open | API-written cell came back `{"desc":"…"}` with no `importSource` key. Other channels *do* populate it on this same return (`isDocImport` 49, `isCalculated` 29, default 22), so the flag is absent specifically for API writes |

**Defect 3 fails silently as success** — this is the sharpest operational finding.
Every clear attempt returned `{"totalImported":1,"totalErrors":0}` **and bumped the
series version**, with the value unchanged. All five are sitting in
`proconnect_import_jobs` as `succeeded / imported_count=1 / error_count=0`.
Anything that treats `importedCount` as proof the return matches what you sent
will be wrong. Diff a fresh Export instead. See §2.

---

# 1. Set the write allowlist — the last gap before route-driven commits

**Shipped:** the two-host fix, the harness, and the docs merged in PR #329
(`b9374b5`, 2026-08-07).

**Still missing: `PROCONNECT_WRITE_ALLOWED_RETURN_IDS` is set in _no_ Vercel
environment** — not production, preview, or development (verified 2026-08-07 via
`vercel env ls`). The route's allowlist **fails closed**, so commit-mode imports
through the Hub are refused with no other symptom. This is why today's six
commits went through `scripts/376` instead: the harness bypasses the route and
carries its own hard-coded allowlist.

```bash
printf 'de74b2b2-ab40-4867-8a2a-d52f1518c58d' | npx vercel@latest env add PROCONNECT_WRITE_ALLOWED_RETURN_IDS production
```

Add `preview` too if you want to exercise commit mode on a preview deploy before
it reaches production — that's the natural way to test §4. **A redeploy is
required either way**; Vercel injects env at deploy time, and the PR #329 build
predates the variable.

What works without it: Export, and Import **dry runs** through the route on any
return — dry runs bypass both write gates. That's the safe half of the pipeline
and it needs no config.

**Do NOT set `PROCONNECT_IMPORT_BASE_URL`.** An earlier draft of this doc
suggested it; that was wrong. `PROCONNECT_TAX_RETURNS_BASE_URL` (the Export host)
is set in no environment either — Export has run off its code default for weeks.
Setting only the Import one creates a second source of truth that can drift, and
the drift failure mode is a 403 indistinguishable from deprovisioning: the exact
trap that cost weeks twice. Both defaults are verified against live 200s. Set
these only if Intuit moves a host.

---

# 2. Make the Import route not trust `importedCount`

**New — comes directly out of defect 3.** The route currently reads a 200 with
`totalErrors: 0` as success, records `status = succeeded`, and triggers a fresh
Export. Defect 3 means that combination can be a complete no-op. Six of the seven
audit rows in prod right now claim success; five of them changed nothing.

The re-export already happens — the missing piece is **using it**. After the
post-write Export, diff the cells actually written against the entries sent, and
either record a `verified` boolean / `succeeded_unverified` status on
`proconnect_import_jobs`, or fail the job outright when the value didn't land.
This matters most for §4: a UI that says "saved" on a silent no-op is worse than
one that errors.

`app/api/proconnect/returns/[returnId]/import/[seriesId]/route.ts` +
`scripts/130_proconnect_return_data.sql` for the column.

---

# 3. Back to Intuit — next call

1. **Defect 3 (no delete/clear)** — still open, and worse than "unsupported": it
   reports success and bumps the version. Ask for either a real clear or an
   honest error.
2. **Defect 4 (`isDetailImport`)** — still open. Bring the baseline: other
   channels populate `importSource` on the same return, so this is specific to
   API writes.
3. **M-series catalog gap** — routing is fixed but the supplied catalog has zero
   M-series rows, so defect 2 can't be verified. Ask for the M-series codes.
4. Optional: whether ProConnect reads are metered (Core vs. metered CorePlus),
   still unconfirmed and relevant before scaling Export polling.

---

# 4. Build the write half of the v0 return read/write page

**Karbon:** "Build v0 frontend for return read/write" · 68 days overdue.
Unblocked now.

**Built:** `/tax/returns/[returnId]?clientId=…` renders engagement context,
snapshot metadata (version, e-file items, series versions), and flattened field
cells by series, with a "Refresh from ProConnect" button. Explicitly read-only.

**Not built:** edit a field and trigger an Import.

1. `components/tax/tax-intake-client.tsx:723` — the import-plan card's action
   button is hard-disabled with stale copy:
   `"Validate with dryRun — awaiting Intuit provisioning"`. We were never
   unprovisioned. Wire it to the real dryRun call.
2. The return viewer has no per-cell edit affordance at all.
3. `app/tax/returns/[returnId]/page.tsx:12` — header comment still describes a
   "403 blocked empty-state."

Suggested shape: inline edit on one cell → dryRun → show validation summary →
explicit confirm → commit → re-export and re-render. Keep dryRun-before-commit
visible in the UI; the route enforces it server-side anyway (30-minute window).
**Do not report success from `importedCount`** — depends on §2.

---

# 5. Clean up the abandoned Edge Function path

Karbon records three Completed sub-items describing an architecture the build
abandoned: a Data Service base URL as a **Supabase Edge Function secret**, a
deployed `proconnect-test-export` Edge Function, and a
`public.proconnect_export_raw` landing table. None of it is live:
`supabase/functions/` holds only the five sync/token functions, Export and Import
are Next.js routes over `lib/proconnect/data.ts`, and `proconnect_export_raw` has
**0 rows** while all real snapshots live in `proconnect_return_snapshots`.

Drop or deprecate the table, delete the Edge Function if still deployed, correct
the Karbon sub-items.

**Also:** `docs/proconnect-meeting-brief.md` still reads "Every call returns HTTP
403" (line 21), "Export ❌ 403, 0 snapshots ever" (line 40), and "Import ⛔
Untested" (line 41). It's a point-in-time brief for a specific call, so either
date-stamp it as historical or refresh it — but don't leave it looking current.

---

# 6. 1040 viewer vs ProConnect — coverage verification

**Karbon:** "1040 viewer vs PC". Independent of the Import work.

The task comment says 28 field mappings; it's **34** now (line 6c via PR #305,
dependent Type enum via #306). Coverage tooling:
`scripts/371-audit-1040-map-coverage.mjs`.

Compare what the viewer renders against the real return, line by line.
Constraint: **the API exposes no calculated values**, only input cells. Lines
12a, 6b, 16, 19 are estimated in our code; others are marked N/A. Verify anything
computed against a **filed PDF**, not the API.

---

# 7. Conditional-mapping leftovers

**Karbon:** "1040 renderer: conditional mappings shipped (migration 373, PR #301)".
Shipped and live; two items stayed open.

1. **Filing-status codes 3 (MFS) and 5 (QSS) unconfirmed.** The coded
   filing-status cell (1=Single, 2=MFJ, 3=MFS, 4=HOH, 5=QSS) fans out to five
   boolean `fs_*` lines via value-predicate conditions
   (`scripts/373_form_1040_conditional_mappings.sql:18,100`). Only a real return
   with those statuses confirms them — wait-for-data, check when one syncs.
2. **Q2–Q4 estimated payments.** Codes are known — `s5400` amount-paid `c2`=Q1,
   `c4`=Q2, `c6`=Q3, `c8`=Q4 (`scripts/369_form_1040_sentinel_round2_ty2025.sql:8`)
   — but line 26 maps Q1 only because the map schema holds **one code per line**.
   Summing needs the aggregate mechanism used for multiple W-2s (the `*` wildcard
   prefix, commit `8d46511`) or a new multi-code row type. Schema change, not a
   discovery gap.

---

## Suggested order

§1 whenever the next deploy goes out (it needs a redeploy anyway, and only §4
depends on it) → §2 (small, and §4 depends on it) → §3 whenever the next Intuit
call lands → §4 → §5 as cleanup. §6 and §7 are independent.
