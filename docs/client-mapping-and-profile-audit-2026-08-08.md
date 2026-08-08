# Client profile & Master Client mapping audit — 2026-08-08

Full review of all 2,191 Hub master clients (1,460 contacts + 731 organizations)
against Intakes, Debriefs, Calendly, Zoom, ProConnect, Ignition and Karbon.
Every number here was measured against production, not estimated.

Work was classified into two tiers and only one tier was applied:

- **Tier A — deterministic.** Recomputing a derived cache, mirroring a link the
  database already holds where an independent signal (exact normalised email,
  exact Karbon key) confirms it. Applied.
- **Tier B — probabilistic.** Anything resting on name similarity, email-domain
  matching, or a heuristic matcher's output. **Not applied.** Adversarial
  re-verification found concrete false positives in every Tier B candidate; the
  specifics are in "Rejected changes" below, because they are the most valuable
  part of this audit.

---

## What was applied

| Change | Before | After |
|---|---|---|
| `client_profile_summaries` rows | 1 | **2,191** |
| — of which organizations | 0 | **731** |
| Profiles carrying a ProConnect id | 0 | **1,442** |
| Profiles carrying an Ignition id | 0 | **919** |
| ProConnect-linked clients visible in master mapping | 1,329 | **1,442** |
| Clients linked to all three systems | 815 | **846** |
| ProConnect + Ignition links visible (not collapsed) | 2,449 | **3,118** |
| `calendly_event_clients` | 53 | **205** |
| `zoom_meeting_clients` | 139 | **220** |
| Clients with Calendly history on profile | ~40 | **137** |
| Clients with Zoom history on profile | ~60 | **147** |
| Unlinked intakes | 50 | **41** |
| Unlinked debriefs | 354 | **352** |
| Firm-wide lifetime revenue on profiles | $337,658 (would-be) | **$1,197,517** |
| Firm-wide AR on profiles | $985,118 (would-be) | **$120,109** |

Scripts: `391_fix_master_client_mapping_view.sql`,
`392_backfill_meeting_client_links.sql`,
`393_backfill_client_profile_summaries.sql`. All idempotent.

---

## Root causes found

### 1. No organization could ever have a profile

`computeClientProfile()`'s organizations branch selected a `tags` column.
`organizations` has no `tags` column (nor `is_prospect`, nor
`legacy_motta_client_id`). PostgREST rejects a select naming an unknown column,
so the result was null, `if (!o) return null` fired, and the function returned
**before** its UPSERT — for every organization, every time. This is why the
cache held exactly one row, and why that row is a contact.

### 2. The ProConnect id lookup was dead code

The resolver queried `proconnect_clients.legacy_motta_client_id`. That column
does not exist. Every profile therefore reported `proconnect_client_id = null`
while 1,442 clients held a real link. Proven with a live example: Lane Krai
carries ProConnect `9341456793252377` in both `proconnect_clients.hub_contact_id`
and `client_mapping`, yet the cached profile recorded null.

### 3. Revenue was understated by 72%

Collections live in **two disjoint places**, an artefact of two eras of the
Ignition sync — verified invoice by invoice:

| Invoice status | Rows | `amount_paid` | Payment rows | Collection recorded in |
|---|---|---|---|---|
| `paid` | 749 | $332,507.89 | **0** | `amount_paid` |
| `issued` | 1,957 | **NULL** | **1,764** | `ignition_payments` |

Reading only `amount_paid` reported $337,658 against a true **$1,197,517**, and
included $5,150.50 of `amount_paid` sitting on *voided* invoices.

### 4. AR was overstated 8x

`invoices_outstanding` was derived as total-minus-paid, which booked the 1,957
`issued` invoices ($906,795 of scheduled forward billing) as receivable.
`amount_outstanding` is **NULL, not 0**, on exactly those rows — so neither a
blanket sum of it (drops their unpaid remainder) nor a blanket derivation
(re-books the $866k already collected) is right. It has to be decided per
invoice. Doing so makes the book reconcile exactly:

```
billed 1,317,626.09 − collected 1,197,516.89 = outstanding 120,109.20
```

### 5. The master mapping was hiding links two ways

**No write path maintains `client_mapping`.** The `auto_link_proconnect_to_hub`
trigger, both `/api/tax/client-links` routes, `lib/ignition/sync.ts` and RPC
`apply_ignition_client_match` all write **only** the native columns.
`client_mapping` was populated by one-off scripts, so coverage decayed after
each run. `link_source` proves it: `auto_fuzzy` 198/198 mirrored, but NULL
`link_source` 0/140, `auto_name_backfill_2026_08_03` 0/40,
`orphan_backfill_2026_05_28` 0/20.

**`max(<id>) GROUP BY internal_client_id` silently dropped links.** The old view
justified this with a guarantee of "at most one non-null value per group". That
guarantee is false: 361 clients hold several ProConnect records (spouse and
entity returns) and 174 hold several Ignition records — so 392 ProConnect and
277 Ignition links never appeared, and the `ignition_*` detail columns came from
an arbitrary lexicographic winner.

The view now reads natively and exposes `proconnect_client_ids` /
`ignition_client_ids` arrays plus counts, keeping every existing column's name,
type and position so its consumers are unaffected.

### 6. Other computation defects fixed

- **Org-wins precedence was not applied to facts.** Rows carrying both a
  `contact_id` and an `organization_id` were counted onto *both* profiles: 9
  work items, 2 debriefs, 55 proposals, 28 invoices, 81 Ignition clients —
  $109,759 of proposal value and $11,975 of invoice value double-counted.
- **Karbon paid test** used `/paid/i`, which also matches `Unpaid` and
  `PartiallyPaid`. No impact today (3 rows, all null status) but a landmine for
  when that sync turns on. Now an exact allow-list.
- **Cancelled Calendly events** were excluded from `last/next_meeting_at` but
  counted in `total_calendly_events`, so count and timestamps disagreed.
- **Ignition id** came only from proposals, leaving 517 Ignition-linked clients
  with no identifier because they had no proposal.

---

## Rejected changes — and why

Every mapping mutation proposed during this audit was independently
re-verified and **failed**. These are not applied, and should not be applied
without a human decision per row.

**Ignition org-wins promotion (30 rows).** Would attach one real client's
records to a different real client:
- `Alliance Physical Therapy, LLC` → org `Synergy Green River Building` —
  3 proposals, 31 invoices, **$25,497 re-attributed to the wrong legal entity**
- `La Crue Enterprises LLC` → `La Crue Enterprises Inc`, and `Upiri, PLLC` →
  `Upiri LLC` — **separate taxpayers, separate EINs, different return types**
- 8 of the 30 are personal 1040 engagements that would be moved onto an LLC
  (e.g. `Raquel Vasquez-Pennington` → `417 Lincoln LLC`)

The `contact_organizations` guard offered as proof excluded **0** of 31 rows —
it has no discriminating power, and is circular (the matcher likely derived the
org link from that membership row in the first place).

**ProConnect mirror into `client_mapping` (200 rows).** The "native FK" being
mirrored is itself the output of `auto_link_proconnect_to_hub`, which matches on
name with `LIMIT 1` and **no `ORDER BY` and no ambiguity check**. Concrete false
positive: org `Bhairavi Devi LLC` would receive 5+ ProConnect rows carrying
**two different tax IDs**. 20 of the 200 have every identifying field NULL on
the ProConnect side yet already carry a hub link.

**Orphan `internal_clients` repoint (4 rows).** 2 of 4 target the **wrong Kevin
Zinovitch** — `contacts` holds two rows with that name and different Karbon keys.

**Single email-matched Ignition link.** Would have raised `23514`:
it set `match_status = 'matched'`, which is not in the CHECK constraint's
allow-list (`unmatched`, `auto_matched`, `manual_matched`, `manual_review`,
`no_match`).

---

## Traps avoided in enrichment

Two intake→client field mappings look obvious and are wrong:

- **`business_tax_classification` → `organizations.entity_type`.** That column
  is a Karbon *relationship-segment* field (`Client`, `Client | Prospect`,
  `Partner (Vendor / Supplier)`, `Motta | Internal`), not a tax classification.
  Writing tax classification into it would corrupt client segmentation on 105
  rows. There is no correct target column; this needs a schema decision.
- **`referral_source` → `contacts.source`.** `referral_source` holds a
  *referrer's personal name* (`Jared Tishler`, `Ross Blount`, `Dat Le`), while
  `source` is an acquisition-channel field. The right target is `referred_by`.
  This would have polluted 136 contacts.

Also: `organizations` contains **44 rows in 5 exact-name collision groups**
(`SHIN` ×17, `testgrace` ×10, `tekyz` ×8, `Trailways Investments LLC` ×7,
`Northwestern Mutual` ×2), all Karbon-sourced with distinct
`karbon_organization_key`. Business-name equality is therefore **not** a
deterministic link signal.

---

## Open questions needing a decision

1. **Deploy coupling (act on this first).** `getClientProfile` recomputes any
   row older than 600s. The *deployed* code still has the bugs above, so once
   traffic reads a contact profile it will overwrite the corrected row with the
   old computation. Organization rows survive (the old code returns before its
   UPSERT) but the API returns null for them. **The data backfill and the
   `lib/clients/profile.ts` fix must ship together.**
2. **AR semantics.** Are the 1,957 `issued` invoices ($906,795) scheduled future
   billing, or genuinely receivable? This audit treats them as billed-minus-
   collected, giving $120,109 AR. Confirm with the Ignition owner.
3. **`needs_attention` is true for 2,191 of 2,191 clients**, driven by "No
   owner/manager assigned" (2,189) and "Missing phone" (1,294). Gating on the
   actionable reasons only (overdue work OR outstanding balance) would flag
   ~700. Which definition does the firm want? The data-quality reasons probably
   belong in a separate column so the attention queue stays a queue.
4. **`client_owner_name` resolves for 2 of 2,191 clients.**
   `work_items.client_owner_id` is empty on all 3,866 rows;
   `contacts.client_owner_id` and `organizations.client_owner_key` are empty.
   This is a source-data gap, not a computation bug — where should ownership be
   recorded?
5. **`profile_completeness` cannot reach 100.** The 10-point
   `legacy_motta_client_id` bucket is unreachable for all 731 organizations (no
   such column) and the 10-point owner bucket for 2,189 clients. Reweight per
   `client_kind`.
6. **Debrief action items carry no completion state.** None of the 160 items has
   a `status`/`completed_at` key, so `open_action_items` equals *total* items and
   can never decrease. Should the debrief UI stamp completion, or should action
   items become a real table?
7. **`debriefs.karbon_client_key` holds two namespaces.** 318 of 590 populated
   values are legacy Airtable codes (`MA_CAINE_PATRICK_9681`), not Karbon keys.
   It also *lies*: on 18 linked debriefs the code names a different client than
   the debrief is attached to, and the native work-item FK backs the existing
   link in all 18. The codes should move to their own column.
8. **Karbon write-back authority.** The intake address/phone enrichment targets
   Karbon-synced columns. If a Karbon pull treats Karbon as authoritative, that
   enrichment is transient. Deferred pending this answer.

---

## Pipeline problems no SQL can fix

- **The `website` intake channel has a 92% link-failure rate** (12 of 13
  unlinked, `link_method` NULL on all 13) — all 13 have an email, so matching
  simply never ran. It is the actively-used channel (latest 2026-08-07).
  Backfilling is pointless while this keeps producing orphans.
- **`link_error` is NULL on 243/243 intakes**, so the intake status card's
  `link_errors_30d` panel reads zero while 41 rows sit unlinked. The diagnostics
  write is gated on a flag only raised in the create-fallback branch.
- **Zoom participant sync coverage:** 355 of 403 past meetings have zero
  participants synced; 380 have `past_details_synced_at` NULL. Participant-based
  linking has a hard ceiling of 28 of 405 meetings (6.9%) regardless of matcher
  quality. Of 194 participants, 138 are Motta staff and 51 have no email — the
  remaining 5 external participants are already linked. **Re-run the
  past-meeting participant sync**; that is worth more than any matcher work.
- **`debriefs.calendly_event_id` / `zoom_meeting_id` / `meeting_id` are NULL on
  all 916 rows.** The firm is discarding its richest human-confirmed
  meeting↔client signal. Fixing the write path forward is cheap.
- **310 of the 352 remaining unlinked debriefs have no structured signal at
  all**, and sampled notes include a vendor meeting with Intuit staff and a
  recruiting write-up — i.e. some are not client debriefs and have no correct
  client to link to.

---

## Data-quality notes

- **94 of the 100 remaining zero-link clients were auto-minted from Zoom
  participant display names** (`source='zoom'`, no email on 87, no work items,
  no debriefs). They inflate the master-client count on every sync. Consider
  minting these into a staging table instead.
- **Karbon mapping is clean:** all 854 `client_mapping` rows carrying a
  `karbon_client_id` agree with the native column, and all 2,085 Karbon keys are
  distinct across hub records. Zero disagreements, zero duplicates.
- **2 `internal_clients` rows are neither a contact nor an organization**,
  violating the table's stated invariant, and 4 `client_mapping` rows point at
  them — making those rows invisible to the master mapping.
- **Debrief tax/revenue enrichment is void**: `tax_year`,
  `adjusted_gross_income`, `taxable_income`, `state_tax` and `recurring_revenue`
  are 0% populated across all 915 debriefs, and no `contacts`/`organizations`
  column exists to receive them. `tax_returns` is the canonical home.
