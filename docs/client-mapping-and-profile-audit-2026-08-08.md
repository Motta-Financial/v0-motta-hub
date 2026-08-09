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
| `calendly_event_clients` | 53 | **205** (1 flagged for review) |
| `zoom_meeting_clients` | 139 | **219** (11 flagged for review) |
| Clients with Calendly history on profile | ~40 | **137** |
| Clients with Zoom history on profile | ~60 | **147** |
| Unlinked intakes | 50 | **41** |
| Unlinked debriefs | 354 | **351** (25 staged for review, 326 not recoverable) |
| Client-attributed lifetime revenue on profiles | $337,658 (would-be) | **$1,214,939** |
| Client-attributed AR on profiles | $985,118 (would-be) | **$102,687** |

Intake-driven field enrichment (fill-only-if-empty, from each client's latest
intake):

| Field | Contacts before → after | Organizations before → after |
|---|---|---|
| `address_line1` | 128 → **254** | 0 → **21** |
| `address_line2` | — → +43 | — |
| `zip_code` | 164 → **253** | 63 → **78** |
| `city` | 513 → **522** | — |
| `state` | 574 → **577** | — |
| `phone_primary` / `phone` | 740 → **743** | 157 → **162** |
| `referred_by` | 0 → **140** | 0 → **25** |
| `employer` | 0 → **67** | n/a |

Scripts: `391_fix_master_client_mapping_view.sql`,
`392_backfill_meeting_client_links.sql`,
`393_backfill_client_profile_summaries.sql`,
`394_link_intakes_and_debriefs_deterministic.sql`,
`395_enrich_clients_from_intakes.sql`. All idempotent.

---

### Verification status of what was applied

Every mapping *mutation* proposed during this audit went through an independent
adversarial re-verification pass, and all of them failed it — see "Rejected
changes". Those are not applied.

The changes that **were** applied fall into two groups:

- **Adversarially verified**: the intake email links and the debrief Karbon-key
  links. One finding from that pass was acted on — junk free text (`NA`,
  `John Snow Test`) had been written into `referred_by` / `employer`; those 8
  rows were cleaned and guarded.
- **Adversarially verified on a resumed run, and corrected as a result.** The
  first verification pass hit a session limit before reaching the meeting
  mirrors; resuming it found a real defect in the Zoom bridge that the original
  self-check had missed, because that check verified the *contact* side (invitee
  email equality) and never asked whether the Zoom meeting and the Calendly
  event are the same meeting. `zoom_meetings.calendly_event_id` is itself a
  heuristic bridge and mis-fires on reused static rooms: **"Dat Le's Personal
  Meeting Room" was bridged to a booking 295.9 days away**, attaching an
  unrelated contact.

  Measured across the 81 rows written: 69 clean, 12 implausible (11 more than
  5 minutes apart, 2 cancelled invitees, 2 cancelled events, 1 static room).
  Of the 12, **11 have the Zoom topic independently naming the contact's
  surname** — ordinary rescheduled bookings whose attribution is still correct.
  Exactly **1 was both implausible and uncorroborated**, and it was deleted.
  The 11 are kept but stamped `needs_review = true, confidence = 0.60` with a
  reason, answering the fair criticism that writing them at `confidence = 1.00,
  needs_review = false` hid the doubtful ones from the only surface a reviewer
  would check. Zoom links: 220 → **219**. Script 392 now carries the
  plausibility gate, verified to insert 0 rows on a re-run and unable to
  reintroduce the deleted link.

  One Calendly row was also flagged (`confidence = 0.70`): its invitee email
  matches **two duplicate contact records for the same person**, so the human is
  right but the record chosen is arbitrary — the contacts need deduping.

  Two of that pass's claims did **not** hold, checked rather than accepted: its
  headline false positive ("Micaela Palacios' Zoom Meeting" → William Randolph
  III) is a **pre-existing** `match_method='email'` row from 2026-05-30, not from
  this work; and the 5 invitee links with no email agreement are pre-existing
  `name_phone`/`name` rows. All 152 rows written here are email-corroborated.

- **Verified by direct reconciliation only** — the adversarial pass for the
  2,191-row profile backfill did not complete. What was checked instead:
  - the profile backfill reconciles to the cent, firm-wide and on every client
    row, and emits exactly 2,191 rows for 2,191 clients with 0 duplicate keys,
    0 orphan profiles and 0 clients missing a profile
  - 3 Zoom meetings carry more than one contact; all 3 predate this work
    (manual links from 2026-05-30 and an `auto_created` batch) and are
    legitimate household/multi-party meetings

  These are derived-cache and mirror operations rather than new identity claims,
  and all are idempotent and recomputable — but a second adversarial pass over
  them is still worth running.

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

### 3. Revenue was understated by 72%, and it took three attempts to get right

The authoritative collection flag is **`ignition_invoices.payment_state`**, and
it is the only source that reconciles. The trap is that 1,918 invoices carry
`status='issued'` with `payment_state='paid'` — **$886,401 genuinely collected**
— while their `amount_paid` **and** `amount_outstanding` are *both* 0.00. Three
sources were measured against the book before settling:

| Source | Revenue | Verdict |
|---|---|---|
| `amount_paid` alone (original code) | $337,658 | 72% understated |
| `amount_paid` + `ignition_payments` ledger | $1,197,517 | still $17,422 short |
| **`payment_state`** | **$1,218,909** firm-wide | **reconciles** |

The payments ledger falls short because some payments sit in `uncollected` or
`cancelled` states and some paid invoices have no payment row at all. It is now
used only to *date* a collection, never to size one. Voided/archived/draft are
excluded — they held $5,150.50 of `amount_paid` that was previously counted.

### 4. AR was overstated 8x

Outstanding follows from the same rule as billed-minus-collected. Neither raw
column works alone: `amount_outstanding` is 0.00 on every `issued` row (so
summing it erases $20,394 of genuinely unpaid `issued`/`unpaid` invoices), while
the original total-minus-`amount_paid` booked the whole $886k of *collected*
`issued` billing as receivable — $985,118, an 8x overstatement that fired a
false "$X outstanding" attention reason on 322 clients.

Verification identity, which now holds firm-wide **and on every single client
row** (0 violations of `billed = collected + outstanding`):

```
firm-wide:          billed 1,322,244.59 = collected 1,218,908.89 + owed 103,335.70
client-attributed:  billed 1,317,626.09 = collected 1,214,939.39 + owed 102,686.70
```

The two differ only by the 10 invoices that carry no client link.

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
2. **AR semantics — largely resolved, one thing to confirm.** `payment_state`
   answers it: of the `issued` invoices, 1,918 ($886,401) are collected and 39
   ($20,394) are genuinely unpaid, giving $102,687 client-attributed AR. The one
   assumption left is that **no partial collections exist** — true today, since
   `amount_paid` is either 0 or the full amount on every row. If Ignition starts
   recording part-payments, the binary rule needs revisiting.
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

## Debriefs: every path, measured against a holdout

All 915 live debriefs were reviewed. Each candidate linkage path was validated
against the **already-linked debriefs** — where the true answer is known — before
being trusted, and the measured precision decided the action:

| Path | Candidates | Precision (holdout) | Action |
|---|---|---|---|
| Exact Karbon key → contact/org | 2 | 100% | applied (script 394) |
| `debrief_work_items` junction, single work item | 1 | **99.4%** (527/530) | **applied** |
| Legacy Airtable code → `user_defined_identifier` | 25 | **88.1%** (133/151) | staged for review |
| Notes name exactly one organisation | 16 | **15.2%** (26/171) | **discarded** |
| Debrief author + date → that member's meetings | 57 | **24.6%** (14/57) | **discarded** |
| `karbon_work_url` → `#/work/` or `#/contacts/` key | 15 | n/a | dead end — 0 of 15 keys exist in the Hub |

Two paths look attractive and are not. **Notes-name-an-organisation** is noise:
names like "SEED" or "Ramp" occur in ordinary prose, and 89 of its 171 holdout
hits were on debriefs actually linked to a *contact*. **Author + date** fails
because team members hold several meetings a day and debriefs aren't written the
same day. Staging either would have handed a reviewer mostly-wrong rows.

The legacy-code path could not be lifted: requiring the notes to mention the
resolved contact's surname — a genuinely independent signal — moved precision
from 87.7% to 89.7% across 29 rows, i.e. no useful lift.

**Final accounting (sums to 915, verified):** 564 linked · 25 staged · 3 carrying
a code that matches zero or several clients · **323 with no structured signal of
any kind**.

### The Karbon work-item path works — and is already fully exploited

`debriefs.karbon_work_url` holds a Karbon work key (`…#/work/<key>`) that joins to
`work_items.karbon_work_item_key`, and from there to the client. The formats match
exactly (same alphabet, 10–12 chars, identical URL shape). Measured:

| | Debriefs | Key resolves to a work item | Linked |
|---|---|---|---|
| Debriefs with a `#/work/` key | **481** | **468** | **468 (100% of resolvable)** |
| …whose key resolves to nothing | 13 | 0 | 0 |

Every debrief whose work key resolves **is already linked**. The path is not
under-used; it is the mechanism that produced most of the existing links.

The 13 that fail do so because the work items themselves are **absent from the
Hub** — 8 distinct keys, checked against `work_items`, `busy_season_work_items`,
`karbon_notes`, `karbon_tasks`, `karbon_timesheets`, `karbon_invoices`,
`tax_return_links`, `project_mapping` and `work_items.related_work_keys`: zero
hits anywhere. They were deleted in Karbon or never synced. Recovering them means
re-fetching those 8 work items from the Karbon API (`KARBON_ACCESS_KEY` /
`KARBON_BEARER_TOKEN` — not present in this environment), not more SQL.

### Three eras explain the whole backlog

Splitting by date makes the shape obvious:

| Era | Debriefs | Linked | Have a work key | Have a client code | Unlinked with **no signal at all** |
|---|---|---|---|---|---|
| **1. Legacy Airtable** (pre 2024‑Q4) | 247 | **0 (0%)** | 0 | 0 | **247** |
| **2. Karbon work-item** (2024‑Q4 → 2025) | 580 | 480 (83%) | 481 | 508 | 59 |
| **3. Current** (2026+) | 88 | 84 (95%) | 0 | 82 | 3 |

So **247 of the 351 unlinked debriefs (70%) predate the Karbon work-item
integration entirely** — they carry no work URL, no client code, nothing. No
work-item strategy can reach them, because there was no work item when they were
written. Era 3 links at 95% without a work key at all, via a newer direct path.

**Where era 1's client associations actually live:** the original Airtable base.
`public.meeting_notes_debriefs` is a **0-row staging table** whose columns are
exactly what is needed — `client_name`, `client_number`, `karbon_client_id`,
`karbon_contact_url`, `client_owner`, `client_manager`. It was built to receive
that export and never populated. Importing it is the only route to those 247.

### Why the remaining 309 cannot be tied to a client from Supabase alone

These are short (avg 177 characters) human meeting notes that name people by
**first name only** — *"Talked to Greg about pricing"*, *"Met with Sarah who is a
friend of Andrew's"*, *"Caught up with David briefly"*. First-name matching
across a 1,460-contact book is a guess, not a link. Many are prospect or referral
conversations with no client record by design, and at least one is a vendor
meeting (*"Met with Steve and Juan from Intuit ProConnect"*) that correctly has
no client. Recovering these needs a human who was in the room, or the
Karbon/Airtable source that originally held the association.

New table `debrief_client_link_candidates` holds the 25, with the measured
precision travelling on each row. It carries a **rejection ledger** — rejected
rows are kept, so the generator can never re-propose a candidate a human has
already declined — which was the gap adversarial review flagged in every earlier
review-surface proposal.

Also found: **12 exact-duplicate debrief rows** (same notes and same
`debrief_date`). None has a linked twin, so they offer no linkage shortcut, but
they inflate every debrief count by 12 and should be deduped.

## The profile cache has no working invalidation

`lib/clients/profile.ts` exports two invalidation hooks. One of them is **never
called at all**:

- `markClientProfilesStaleForRefs()` — defined, exported, **zero callers**.
- `markClientProfileStale()` — exactly one caller,
  `app/api/contacts/[id]/organizations/route.ts`.

So nothing invalidates a profile when a work item, debrief, invoice, payment or
meeting changes. Demonstrated within 15 hours of the backfill: 7 work items were
created after it ran (first at 2026-08-09 00:07Z) and **5 clients' cached work
counts drifted** while `stale_at` stayed NULL on all 2,191 rows. Those 5 were
refreshed, and drift is now 0 — but it will recur.

Two things follow, and they matter more than the backfill itself:

1. The ingest paths need to call the batch hook. Until they do, the cache is only
   as fresh as the last full rebuild.
2. `getClientProfile()` defaults `maxAgeSeconds = 600`, so a read falls back to
   the ~13-round-trip per-client recompute after 10 minutes. Any scheduled
   rebuild window must be **shorter** than that, or raise the read default —
   otherwise the batch job never actually relieves the read path.

One further caveat on the backfill worth stating plainly: `proconnect_client_id`
and `ignition_client_id` on `client_profile_summaries` are **scalar**, but 437
clients hold 2–6 ProConnect records and 178 hold 2–7 Ignition records. The
earliest-created pick is deterministic and stable, but it is still a *choice* —
11 of those clients have ProConnect records with conflicting surnames and 34 with
conflicting emails, so the scalar cannot be read as "the" identifier. The mapping
view exposes `proconnect_client_ids` / `ignition_client_ids` arrays with counts;
the profile table should gain the same, which is a schema change and is listed in
the open questions rather than done here.

Also note `client_profile_summaries` has RLS enabled with a deny-all policy, so
all access is via the service role.

## `needs_review` is not a safety net — treat it as a to-do list

Worth knowing before anyone relies on the flag: `needs_review` is honoured in
some consumers and ignored in others.

- **Ignored**: `lib/clients/profile.ts:308-309` selects from
  `calendly_event_clients` and `zoom_meeting_clients` with no `needs_review`
  predicate, and `app/api/clients/[id]/context/route.ts` does the same. A
  flagged link therefore counts as a **confirmed** communication on the client
  profile and in ALFRED's context.
- **Honoured**: `lib/meetings/sync-hub-meetings.ts` `bestLink()` demotes flagged
  rows, and `lib/zoom/summarize-transcript.ts` prefers unflagged ones — but
  `bestLink()` still returns a flagged row when it is the *only* link, and it
  writes `organization_id`/`contact_id` onto `public.meetings` and can feed deal
  creation from there.

This is why the one genuinely-wrong Zoom bridge link was **deleted rather than
flagged**. For the 12 rows kept-and-flagged the downstream use is correct, and
that was measured, not assumed: all 11 flagged Zoom rows have the meeting topic
independently naming the linked contact's surname (7 of them are the sole link
on their meeting), and the 1 flagged Calendly row points at one of two duplicate
records for the right person.

If the flag is meant to gate anything, the profile and context readers need the
predicate added.

## Also found: the invitee matcher has no ambiguity guard

`lib/calendly-invitee-match.ts` resolves a contact by email with
`.or(primary_email.ilike, secondary_email.ilike).limit(1).maybeSingle()` — no
check that exactly one contact matched, so it picks an arbitrary row when several
share an address. `lib/calendly-sync.ts:591-604` then upserts that `contact_id`
onto `calendly_invitees` unconditionally on conflict. That is the upstream cause
of the duplicate-record link flagged above, and it will keep producing them.

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
