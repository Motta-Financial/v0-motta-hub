---
name: proconnect-1040-mapping
description: Interpret and map Intuit ProConnect Tax Online (PTO) 1040 return field data. Use when reading a ProConnect Series Map Export payload, identifying what a series/prefix/code/suffix field represents on a 1040, or constructing Series Map Import entries. Covers the nested field model, field-cell semantics, version stamps, and Import safety rules. Phase 1 = Individual 1040 (IND) only.
---

# ProConnect 1040 Series Map Mapping

## Scope

This skill covers the ProConnect Open API "Series Map" Export and Import for the
**ind (1040) module only**. Other modules (cor, sco, par, fid, exm, gft) use the same
endpoints — only the codeIds/seriesIds change — but are out of scope here until Intuit
ships them.

Two endpoints — **on two different hosts** (doc v3 §3):

- Export (read): `GET https://protaxdata.api.intuit.com/v2/clients/oii-client/{clientId}/returns/{returnId}/data`
- Import (write): `POST https://protaxonlineimport.api.intuit.com/v2/clients/{clientId}/returns/{returnId}/import/series/{seriesId}`

> **Every 403 on this API is a path bug until proven otherwise.**
> The gateway answers `403 AuthorizationFailed` for *any* route it doesn't
> recognise — verified 2026-08-07: a deliberately bogus path under
> `/v2/clients/oii-client/{c}/returns/{r}/` returns the same 403 as a real
> endpoint reached the wrong way. So a 403 never distinguishes "not entitled"
> from "wrong URL", and it must never be read as a provisioning gap. Motta is
> provisioned (realm 9130356180193146, scope `com.intuit.proconnect.taxreturns`).
>
> Two independent instances of this have now bitten the project:
>
> 1. **Export needs `oii-client/`; Import must not have it.** Doc versions
>    before v3 omitted the segment from the Export path. Cost several days of
>    misdiagnosis. Fixed 2026-07-27, adopted in doc v3.
> 2. **Import is on its own host.** The Hub posted Imports to the Export host
>    and got a uniform 403, which again read as "write not provisioned" — the
>    `proconnect_import_jobs` table stood empty from build until 2026-08-07 for
>    this reason alone. Fixed in `lib/proconnect/data.ts`.
>
> The full 2×2 was measured on the sentinel return 2026-08-07: import host
> **without** `oii-client/` → 200; import host **with** it → 403; export host
> either way → 403. Don't "tidy up" the two paths to match each other.

## The data model (§1.1)

A return's field data is a nested map, four levels deep, ending in a field cell:

```
data
└── {seriesId}   e.g. "s1", "s11", "s200"
    └── {prefixId}   e.g. "p0", "p1"
        └── {codeId}   e.g. "c43", "c1000100009"
            └── {suffixId}   e.g. "x1000", "x1"
                └── field cell  (the actual value + metadata)
```

Default constants:

- `s1` = the federal series (default for ind)
- `p0` = the default prefix (used when no prefix applies)
- `x1000` = the default suffix (used when none applies)

So a plain federal field with no prefix and no instance lives at `s1 / p0 / c<code> / x1000`.

**Series ≈ input screen.** A series maps to a screen in the PTO left-hand nav. In the
Batch Edit Data tool, "Current input view series: N" tells you which series the screen
you are looking at belongs to — that is the fastest way to go from a screen you can see
to the series id you need.

### Prefix = instance index on repeating screens

`p0` is the default only for screens that occur once. On repeating screens the prefix is
the **1-based instance number**, not a constant. Observed in live exports: series `s11`
(W-2) carries `p1`, `p2`, `p3` for the first, second, and third W-2 on the return, with
the same code ids repeated under each. A return with one W-2 has only `p1` — there is
no `p0` on that series at all.

So when reading, do not assume `p0`; enumerate the prefixes actually present. When
writing, the prefix you choose selects **which instance** you are writing to, and
writing to a prefix that does not exist yet creates that instance.

### Suffix is not always `x1000`

`x1000` is the default, but it is per-code, not global. Observed in live exports on
`s11`: codes `c808` and `c816` consistently use suffix `x1`, and `c77` appears under
both `x1000` and `x1001`. Read the suffix off the export rather than assuming — an
Import entry sent to the wrong suffix will not land where you expect.

## Field cell semantics (§A.6)

Each leaf object may contain these properties. **Absence of a property means "not set" —
treat a missing property as null.**

| Property | Meaning |
|---|---|
| `val` | Numeric or formatted value (amount or coded value) |
| `desc` | Descriptive text label |
| `src` | Agency / state abbreviation (e.g. `US`, `CA`); defaults to federal context |
| `tsj` | Taxpayer / Spouse / Joint / None flag — one of `T`, `S`, `J`, `N`, or `""` |
| `scope` | e.g. `Federal`, `State`, `Global` |
| `source` | Data-entry source indicator (free string) |
| `cityAbbrev` | City abbreviation for fields keyed on city |
| `docRefSource` | Undocumented — not in Intuit's field model, observed on 4 M-series cells across our 51 snapshots (2026-08-11). Presumably a reference to the source document. Don't write it |
| `importSource` | Array describing the channel that populated the value. `isDetailImport` is *intended* to mean it was written via this Import API (Appendix B) — but see the caveat below |

> **`isDetailImport` is still broken — re-verified end-to-end 2026-08-07 and again
> 2026-08-11.** We committed
> a real Import write and re-exported the cell: it came back as `{"desc": "..."}` with
> **no `importSource` key at all**. Not a wrong flag — an absent one. By contrast, cells
> on the same return populated by other channels do carry it (`["isDocImport"]`,
> `["isCalculated"]`, `["default"]`). So `importSource` cannot distinguish an API write
> from manual data entry; it can only tell you a cell came from one of the *other*
> channels. Track what you wrote yourself. (This is the first test of the flag against
> an actual API write — before 2026-08-07 no Import had ever succeeded.)

### val vs desc is per-code, but not perfectly stable

Most codes are consistently one or the other — a code either carries an amount (`val`)
or text (`desc`). But across six live returns a handful of codes appear as `desc` on
most returns and `val` on one (e.g. the street and city fields). When reading a code you
have not labeled yet, check both properties before concluding the cell is empty.

## Reading an Export response (§A.6)

Top-level fields on the Export payload:

| Field | What it tells you |
|---|---|
| `name` | Display label (`<client name> (<uuid>)`) |
| `clientName` | Client display name |
| `year` | Tax year (e.g. 2025) |
| `type` | Module code — `IND` for a 1040 (Phase 1 only returns IND) |
| `data` | The nested series map (above) |
| `efileItems` | `[{ efileId, included }]` — e-file products on the return |
| `agency` | `[{ abbrev }]` — active agencies (e.g. US, CA) |
| `version` | Return-level version stamp (UUIDv1). **Changes on every write.** |
| `seriesVersion` | `[{ series, version }]` — per-series version stamps |
| `id_uuid` | Return UUID (matches the returnId path param) |
| `id_client` | Numeric client id |
| `id_firm` | Firm UUID |
| `createdBy` | Internal id only (profileId/authId) — **not** a name or email |

Note: `createdBy` and similar are internal IDs. There is no users/preparer endpoint, so
ID → name mapping must be maintained by hand until Intuit ships one.

**Export returns only populated cells.** There is no catalog endpoint and no way to ask
for the full field definition set. A code that is absent from an export is absent because
that return does not use it, not because it does not exist.

## Constructing an Import (§B.5)

One series per call. The series is pinned in the URL path. Body:

```json
{
  "version": "<current series version UUID, or null on first write>",
  "dryRun": true,
  "entries": [
    {
      "prefixId": "p0",
      "codeId": "c43",
      "suffixId": "x1000",
      "val": "150000",
      "desc": "",
      "source": "",
      "tsj": "T",
      "src": "US"
    }
  ]
}
```

Entry rules (§B.5):

- `prefixId`, `codeId`, `suffixId` are always required.
- `codeId` must match `^c\d{1,10}$`.
- `val` is required for codes that carry an amount/coded value; `desc` is required
  for codes that carry text.
- `tsj` is one of `T`, `S`, `J`, `N`, or `""` (empty allowed for codes that don't honor TSJ).
- `src` defaults to the federal agency context if omitted.

## Hard rules — apply every time

- **Cite the doc section** for anything tied to this API. Never paraphrase from memory
  if a section exists.
- **Version stamps (§A.2, §B.5):** Import needs the current series version UUID —
  *unless* writing a series for the first time, then pass `null`. Always store `version`
  + `seriesVersion[]` from Export and reuse them.
- **Dry-run first (§B.2):** every new Import flow runs `dryRun: true` before commit.
- **Partial success is normal (§B.6):** HTTP 200 with per-entry errors in
  `results[].errors[]` is the contract. Only 4xx means the request itself was malformed.
- **Rate limit (§9):** 5 TPS per app per user. On 429, honor `Retry-After`; exponential
  backoff with jitter, start 1s, cap 30s.
- **PII (§8):** never log full request bodies or echo SSN / EIN / TIN values.
- **One series per Import call (§B.2).**
- **Max 500 entries per Import call (§B.5).**
- **No agency auto-creation (§B.7):** an entry referencing an agency not on the return is
  persisted but invisible in the PTO UI until the user adds the agency manually.
- **Import is not idempotent (§4):** repeated calls accumulate writes — de-duplicate
  before retrying.
- **There is no ProConnect sandbox.** A commit writes onto a live return. Write only to a
  return that is explicitly designated for testing, and confirm the returnId before every
  commit — there is currently no way to delete or clear data through the API (see below).

### How the Hub enforces this

`POST /api/proconnect/returns/{returnId}/import/{seriesId}` puts two independent gates in
front of a commit, so the guarantee is structural rather than procedural:

1. **Write allowlist.** The return must appear in the `PROCONNECT_WRITE_ALLOWED_RETURN_IDS`
   env var (comma-separated return UUIDs), otherwise the route returns **403**. It fails
   closed — if the variable is unset, no return can be committed to at all. Designating a
   test return is a deliberate deploy-time act.
2. **Dry-run-first.** A commit returns **409** unless a clean, zero-error dry run of the
   same entry count for the same return and series succeeded within the previous 30 minutes.

Dry runs bypass both gates, because they persist nothing — and their field-rule errors are
a legitimate way to learn catalog facts (max value, maxLength) from real returns.

Audit rows are written for every attempt, including dry runs and validation failures that
never reach Intuit. They record field **addresses** and has-value flags only, never values.

## Known Intuit defects — retested 2026-08-07, defects 3 & 4 again 2026-08-11

Four defects were confirmed by Intuit on the 2026-07-27 call with a target fix of
~2026-08-03. All four were re-tested on 2026-08-07 against the sentinel return
(`de74b2b2-…`), using `scripts/376-retest-intuit-import-defects.ts`. **Two are fixed,
two are not.** The two open ones were re-tested on 2026-08-11 before reporting back to
Intuit — **both unchanged, with byte-identical symptoms.**

| # | Defect | Status 2026-08-07 | Evidence |
|---|---|---|---|
| 1 | Hard cap of **20 instances for dispositions** | ✅ **FIXED** | A dry run of 25 disposition instances (s52 `p1`…`p25`) validated clean, and a real commit at `s52/p25/c800` returned `importedCount: 1`. Instance 25 exists on the return. |
| 2 | **M-screens are not importable** | ✅ **FIXED** | Two independent checks. Routing: `s100M`/`s200M` answer `INVALID_CODE — Code 'c999999999' is not valid for series 's100M'`, identical in shape to the numeric control `s100`, so the series resolves. End-to-end: echoing a real populated M cell (`s200M/p0/c11/x1000`) back as a dry run returned `totalImported: 1, totalErrors: 0`. |
| 3 | **No delete or clear** | ❌ **STILL OPEN** (re-confirmed 2026-08-11) | Five clear shapes tried against a populated cell — `desc:""`, `desc:null`, `val:""`, `val:null`, and omitting the value sub-field entirely. All five returned HTTP 200 with `importedCount: 1`, and the value was unchanged after each. Re-run 2026-08-11 against the same cell (`s52/p25/c800/x1000`): same five shapes, same HTTP 200 / `importedCount: 1` / version bump, value still `RETEST 20260807 DEFECT PROBE`. |
| 4 | **API-written flag not set** | ❌ **STILL OPEN** (re-confirmed 2026-08-11) | See the `isDetailImport` note above — the API-written cell came back with no `importSource` key at all. Re-tested 2026-08-11 with a **fresh** write to an untouched instance (`s52/p26/c800/x1000`, tid `1-6a7ae1cc-31dac7367db124cc68101087`): committed clean, re-export shows `{"desc":"RETEST 20260811 DEFECT PROBE"}` — still no `importSource`. A read-only census of the same return found 338 populated cells with `isDocImport` (49), `isCalculated` (29), `default` (22), absent (238) — and zero `isDetailImport`. |

> **Defect 3 has a sharper edge than "no delete".** A clear attempt doesn't fail — it
> reports **success**. `{"summary":{"totalImported":1,"totalErrors":0}}`, a bumped series
> version, and no change to the cell. Anything that trusts `importedCount` as proof the
> return now matches what you sent will be wrong whenever the entry was a clear. Diff
> against a fresh Export instead.

> **M-screens import fine but are undocumented.** Defect 2 is closed, yet the field
> catalog Intuit supplied contains **zero** M-series rows (748 Federal series, all
> `^s\d+$`) while live returns carry M-series cells. So we can write to an M address we've
> already observed in an Export, but we don't know what any M code *means* and can't
> discover new ones. That's a catalog-delivery gap, not an API bug — raised with Intuit
> 2026-08-11.
>
> Census over `proconnect_return_snapshots` (51 exports on file, 2026-08-11): **39 of 51
> returns (76%)** carry at least one M series — **20 distinct M screens**, **233 populated
> cells** across **105 distinct `series/code` addresses**. Most-seen: `s5619M` and `s200M`
> (13 returns each), then `s4600M` (8), `s5100M` (7), `s100M` and `s2400M` (6), `s52M` and
> `s31M` (4). This is most of the client base, not a quirk of the sentinel return.
>
> Note on shape when re-deriving this: `proconnect_return_snapshots.raw_data` **is** the
> series map itself — there is no `raw_data.data` wrapper, unlike the live Export payload
> that `exportReturnData()` returns. Reading `raw_data.data` yields a silent zero.

#### Decoding an M code by hand — Customer Support Tools

Steve's workaround (2026-08-11), the only decode path we have while the catalog has no M
rows. Inside a ProConnect return: **Return Actions** (blue button, top right) → **Customer
Support Tools** → "Batch Edit Data". Pick a series and it lists every populated cell as a
grid: `SERIES | PREFIX | CODE | SUFFIX | STATEID | CITYID | SOURCE | TSJ | VALUE |
DESCRIPTION`. Confirmed this way: **`s52M` = capital loss carryovers.**

Two limits. It lists only codes **already entered** on that return, so it can't say what an
unpopulated code means or enumerate what a series accepts — it decodes, it doesn't
dictionary. And the screen carries an Intuit warning that it's for use while in contact with
Customer Support, so treat it as read-only reconnaissance; don't edit through it.

#### Open question: is STATEID part of the address?

The Batch Edit grid has a `STATEID` column, and Export carries the same idea as `src`.
Across our 51 snapshots, M cells show `src` for 8 agencies (MA 36, CO 33, NH 13, CA 10,
US 9, NE 2, FL 2, VA 1), and `s52M/p0/c201/x1000` holds `src=NE` on one return and `MA` on
another — *different* returns, one state each. **We have never observed one return holding
two states at the same series/prefix/code/suffix**, and the Export JSON could not represent
it if it did: the map bottoms out at suffix, one leaf per address.

So it's unresolved whether `src`/STATEID is a fifth address dimension or a property of a
single cell. It matters for Import: if two states can share an address, writes need STATEID
to target the right one, and a multi-state return would silently collapse on Export. Ask
Intuit whether that grid can ever show two rows identical except STATEID.

Defect 3 remains the reason test writes belong on a disposable copy of a return rather
than on anything real: if a write goes wrong, the recovery is deleting the return, not
undoing the write.

### Re-running this

```
npx tsx scripts/376-retest-intuit-import-defects.ts survey   # read-only
npx tsx scripts/376-retest-intuit-import-defects.ts probe    # defects 1, 2 — dryRun only
npx tsx scripts/376-retest-intuit-import-defects.ts clear --i-understand-this-writes
npx tsx scripts/376-retest-intuit-import-defects.ts write --prefix p27 --i-understand-this-writes
```

Defect 3 means every `write` burns an instance permanently, so each re-test needs a new
`--prefix`: `p25` (2026-08-07), `p26` (2026-08-11), so `p27` next.

`write` and `clear` refuse any return other than the sentinel, and `write` runs its own
dry run first. Both record audit rows in `proconnect_import_jobs`.

## Code dictionary — what each 1040 code means

**STATUS: PARTIAL.** Confirmed entries below are cross-referenced against Steve's (Intuit)
Batch Edit Data screenshots plus six live Export snapshots (1,685 field cells,
37 series, TY2025) taken 2026-07-27/28. The remainder is being filled by the sentinel-diff
labeling procedure below.

Record **code → meaning only. Never record values** — live exports carry SSNs, wages, and
addresses (§8).

### Series s1 — Client Information

| series | prefix | code | suffix | 1040 field / line | notes |
|---|---|---|---|---|---|
| s1 | p0 | c1000100002 | x1000 | Taxpayer first name | text (`desc`) |
| s1 | p0 | c1000100004 | x1000 | Taxpayer last name | text (`desc`) |
| s1 | p0 | c1000100006 | x1000 | Taxpayer SSN | text (`desc`) — never log |
| s1 | p0 | c1000100008 | x1000 | Taxpayer occupation | text (`desc`) |
| s1 | p0 | c1000100010 | x1000 | Taxpayer date of birth | numeric (`val`) |
| s1 | p0 | c1000100014 | x1000 | Street address | usually text, occasionally `val` |
| s1 | p0 | c1000100015 | x1000 | City | usually text, occasionally `val` |
| s1 | p0 | c1000100016 | x1000 | State | text (`desc`) |
| s1 | p0 | c1000100017 | x1000 | ZIP | text (`desc`) — stored as text to keep leading zeros |
| s1 | p0 | c1000100019 | x1000 | Phone | usually text |

### Series s11 — W-2 (prefix = W-2 instance: p1, p2, p3, …)

| series | prefix | code | suffix | 1040 field / line | notes |
|---|---|---|---|---|---|
| s11 | p{n} | c3 | x1000 | W-2 box 1 — wages | numeric |
| s11 | p{n} | c4 | x1000 | W-2 box 2 — federal income tax withheld | numeric |
| s11 | p{n} | c5 | x1000 | W-2 box 3 — Social Security wages | numeric |
| s11 | p{n} | c6 | x1000 | W-2 box 4 — Social Security tax withheld | numeric; ratio to c5 checks out at 6.2% |
| s11 | p{n} | c7 | x1000 | W-2 box 5 — Medicare wages | numeric |
| s11 | p{n} | c8 | x1000 | W-2 box 6 — Medicare tax withheld | numeric; ratio to c7 checks out at 1.45% |
| s11 | p{n} | c808 | **x1** | Employer name/text field | text; `maxLength` 16; note the non-default suffix |
| s11 | p{n} | c810 | x1000 | Employer text field | text |

The 6.2% and 1.45% ratio checks are worth reusing as a labeling technique: statutory
rates let you confirm a numeric code's identity from a single real return without
entering anything.

### Schedule 1 / Schedule 3 inputs — see `form_1040_line_inputs`

Sentinel round 4 (values `114001`–`114009`) labeled the Schedule 1 and Schedule 3 inputs
that roll up into 1040 lines 8, 10 and 20. Those aren't 1040-face lines, so they live in
**`form_1040_line_inputs`** (verified 2026-08-05, PR #328), not in
`form_1040_proconnect_map` and not duplicated here — a hand-copy would drift.

Sentinel `114003` (alimony *paid*, Sch 1 line 19a) never landed: the field is an
expandable detail table demanding a recipient SSN. Still unobserved — do **not** add it
from catalog evidence alone.

### Unconfirmed — do not treat as mappings

The §A.6 doc sample shows `c1000100001` holding a name-type `desc` and `c1000100009`
holding an EIN-format `desc`. Both are structurally consistent with our exports (each
carries text, never a number), but neither has been confirmed against a labeled 1040.

## Labeling procedure — how to fill the dictionary

Corrected 2026-08-19 — this line was stale and contradicted §"M-screens import fine
but are undocumented" above: Steve (Intuit) already delivered the IND 2025 catalog
(67,810 codes, 748 federal series), loaded in prod. The only remaining catalog gap is
that delivery has **zero M-series rows**, raised with Intuit 2026-08-11. Steve also
explicitly sanctioned self-serve labeling for anything the catalog doesn't cover: enter
data in ProConnect, then read it back through Return actions → Customer Support Tools →
**Batch Edit Data**. Browsing that tool is fine; **do not use its Edit button** — it
carries a support-only warning.

### Sentinel-diff (the reliable method)

1. Export the target return and snapshot it — this is the baseline.
2. In PTO, type a **distinctive sentinel value** into the 1040 line you want to label.
3. Re-export and diff against the baseline. The cell that changed is that line's address.

Choose sentinels that cannot collide with real data — `111001`, `191919`, `828282` —
never plausible amounts like `50000`. On a copy of a real return the baseline is already
populated, and a plausible sentinel can produce a false match against data that was
already there.

Guard against ambiguity: a sentinel that lands in more than one cell (state-wage mirrors
are the usual cause) is not a confirmed mapping and needs manual resolution.

### Two shortcuts that avoid data entry entirely

**Statutory ratios.** Any code pair in a fixed legal relationship can be identified from
one real return — Social Security at 6.2% of box 3, Medicare at 1.45% of box 5. This is
how `c5`–`c8` were confirmed.

**Presence signatures across returns.** Compare which codes appear across a set of
returns. In our six snapshots (five IND, one SCO), `s1` codes fall into distinct groups:
codes present on all six are entity-level fields shared across modules (name, ID number,
address); codes present on the five IND returns only are individual-specific; codes
present on just three are almost certainly **spouse** fields, since three of the returns
are joint. The interleaving is visible in the numbering — `c1000100004`/`c1000100006`/
`c1000100008` appear on every return while `c1000100005`/`c1000100007`/`c1000100009` appear
only on the joint ones, which is the shape of taxpayer/spouse pairs at consecutive codes.

Treat that pairing as a **hypothesis to confirm with sentinels**, not as a mapping. It is
most useful for predicting where to look, and for sanity-checking a sentinel result that
seems off by one.

## What this skill cannot do (yet)

- The code dictionary is partial. Outside the `s1` and `s11` entries above, it can read
  the *structure* of an Export payload and tell you where a field sits, but not what the
  code represents on the 1040.
- It does not know per-field validation limits (max value, maxLength, allowed `src`
  list, etc.) except where observed from real dry-run errors. Note that field-rule error
  messages leak catalog facts — a rejected entry will often tell you the max value or
  length for that code, which is worth capturing when it happens.
- It cannot resolve `createdBy`/assignee IDs to people.
- It covers IND only. The one SCO snapshot in our data confirms the entity-level `s1`
  codes are shared across modules, but nothing beyond that has been checked.
