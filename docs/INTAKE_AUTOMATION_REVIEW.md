# Intake Form — Automation Review

**Date:** 2026-08-07
**Scope:** the prospect journey `Intake form → Hub contact → Karbon → Calendly booking → Zoom meeting → team email`
**Method:** read of the live code paths plus queries against the Motta Hub
production database (`gylupzxitoebhqjnvzuw`).

---

## 0. TL;DR

The individual pieces are built and working. **They are not connected to each
other.** The intake form and the Calendly booking are two independent front
doors, and nothing in the intake flow ever asks the prospect to book.

Production evidence (last 18 months):

| Measure | Value |
| --- | --- |
| Intakes with a resolved Hub contact | 130 |
| …that booked a Calendly meeting within **7 days** | **8 (6%)** |
| …that booked within **30 days** | **11 (8%)** |
| Calendly bookings with **no intake form on file at all** | **83 of 142 (58%)** |

So the described flow — "client takes the intake form, then books via Calendly" —
happens for roughly 1 in 12 intakes. The majority of people who actually book a
discovery call skipped the form entirely.

Closing that gap is the single highest-leverage change available, and the
Calendly API plumbing needed to do it **already exists in this codebase**
(`lib/calendly-api.ts`, `app/api/calendly/scheduling-links/route.ts`,
`app/api/calendly/book/route.ts`).

One correction to the working assumption: **Karbon is no longer driven by
Zapier.** The Hub calls the Karbon v3 API directly. See §2.

---

## 1. What actually runs today

### 1.1 Two live intake front doors

Both are enabled right now, simultaneously:

| Front door | Path | Volume | Most recent |
| --- | --- | --- | --- |
| Jotform `242306172162144` "Motta \| Intake Form" | Jotform → `POST /api/jotform/webhook?token=…` | 230 all-time, 100 in last 12 mo | 2026-07-08 |
| motta.cpa native form | `app/embed/intake/page.tsx` → `POST /api/public/intake` | 12 (mostly test rows) | 2026-08-04 |

`jotform_forms` shows the legacy Jotform form still `is_enabled = true` and
`webhook_subscribed = true`. Nothing has been retired.

Both converge on the same function, so the downstream pipeline is genuinely
shared — that part of the design is sound:

```
lib/jotform/ingest.ts :: upsertIntakeSubmission()
```

### 1.2 The shared ingest pipeline

`upsertIntakeSubmission` (lib/jotform/ingest.ts:52) does, in order:

1. **Persist** — upsert into `jotform_intake_submissions`, keyed on
   `jotform_submission_id` (idempotent).
2. **Resolve the client** — `autoLinkIntakeSubmission`, then on miss:
   `findOrCreateHubContact` (Hub-first, never blocked by a Karbon outage)
   followed by `findOrCreateClient` (Karbon search → create). Writes
   `contact_id` / `organization_id` / `link_method`.
3. **Pair person + business** — when there's both a person and a business name,
   find-or-create the `organizations` row, link as Owner, push to Karbon.
4. **Post-processing** (`runIntakePostProcessing`, ingest.ts:294):
   - resolve `preferred_team_member` → `assigned_to_id`
   - resolve `referral_source` → `referral_contact_id` / `_organization_id`
     (single exact name match only — deliberately conservative)
   - **ALFRED, three parallel passes**: company enrichment
     (`lib/jotform/enrich.ts`), question research
     (`lib/jotform/research-questions.ts`), fee estimate
     (`lib/jotform/fee-estimate.ts`)
   - **firm-wide intake email** via `notifyTeamOfNewIntake`
     (`lib/jotform/notify.ts`), single-flight on `notified_at`
5. **Karbon timeline note** on newly-created Karbon entities
   (`lib/karbon/post-intake-note.ts`).

The team email is genuinely good — identity, ALFRED research brief, ALFRED draft
answer to the prospect's questions, and a fee estimate with line items. That
matches "an automated Intake email that goes out to the team" and then some.

### 1.3 Calendly — a completely separate pipeline

`app/api/calendly/webhook/route.ts` on `invitee.created`:

1. signature verify → dedupe ledger (`calendly_webhook_events`)
2. upsert `calendly_events` + `calendly_invitees`
3. match invitee → contact; **on miss, auto-create a Hub contact** and
   fire-and-forget `pushHubContactToKarbon`
4. `findOrCreateDeal` — opens an opportunity
5. real-time mirror into the unified `meetings` table
6. `runAlfredCalendlyTriage` — org / work-item / service tagging
7. `notifyTeamOfNewBooking` — a second team email

Backstop: `/api/cron/calendly-sync` every 30 min, which also self-heals the
webhook subscription.

### 1.4 Zoom

Zoom meetings are created by **Calendly's own native Zoom integration**, not by
the Hub — the Hub reads `event.location.join_url`. The Hub then *bridges* the
two records by the numeric meeting ID in the URL
(`lib/zoom/bridge-to-calendly.ts`), copying client/work-item tags across, driven
hourly by `/api/cron/zoom-link-sweep`.

Bridge health, last 180 days: 91 active Calendly events, 69 with a Zoom URL, 57
bridged to a `zoom_meetings` row.

---

## 2. Correction: Karbon is direct API, not Zapier

The Hub replaced the Zaps. Karbon contact/org create + match runs through
`lib/karbon/client-sync.ts` against `api.karbonhq.com/v3` on every intake, and
`lib/karbon/create-intake-work-item.ts` carries an explicit note that it
"mirrors the legacy Zapier flow" including the original `WorkTemplateKey`.
The Ignition Zapier bridge is likewise retired (`app/api/ignition/webhook/`
is marked DEPRECATED).

**Action:** confirm no duplicate Zaps are still firing on the Jotform form. The
`/intake` page already has a card for exactly this
(`components/intake/jotform-status-card.tsx` surfaces "other webhooks
registered"). Worth an eyes-on check before the next intake.

---

## 3. Findings, ranked by impact

### 🔴 F1 — The intake form never asks the prospect to book

The wizard's success screen (`app/embed/intake/page.tsx:359`) reads:

> "A teammate will follow up within one business day to schedule your discovery
> call on Zoom."

That is a **manual handoff**, and it is where the funnel leaks. There is:

- no Calendly link on the confirmation screen
- **no client-facing confirmation email at all** — `/api/public/intake` sends
  nothing to the prospect, only to the team
- no nudge for prospects who never book

Result: 8 of 130 intakes booked within a week.

**Fix:** make booking step N+1 of the wizard, not a follow-up task. Two options,
both already supported by code in the repo:

- **Embedded Calendly with prefill** — simplest. Append
  `?name=…&email=…&utm_source=hub_intake&salesforce_uuid=<submission_id>` to the
  Discovery Meeting scheduling URL. The `salesforce_uuid` tracking field flows
  through `mapCalendlyInviteeFields` into `calendly_invitees`, which solves F3
  for free.
- **In-Hub slot picker** — `getEventTypeAvailableTimes` + `createEventInvitee`
  are already wired in `lib/calendly-api.ts:862-924` and exercised by
  `app/api/calendly/book/route.ts`. More work, best UX, no redirect.

Either way, also send the prospect a confirmation email carrying the booking
link, and a 48-hour nudge if `contact_id` still has no future Calendly event.

### 🔴 F2 — 11 of 12 website intakes never got linked to a contact

Every website submission has a name and an email, yet:

```
link_method IS NULL and contact_id IS NULL  →  11 of 12
```

Most are test rows, but at least one is a real prospect (2026-07-29) for whom a
Hub contact **does** exist and **is** in Karbon — the intake row simply never
had `contact_id` written back.

Root cause is a structural one in `lib/jotform/ingest.ts:106-227`.
`findOrCreateHubContact` is individually try/caught (lines 111-130), but
`findOrCreateClient` on line 132 is **not**:

```ts
try { const hub = await findOrCreateHubContact(...) ; hubFallback = {...} }
catch (err) { /* logged, safe */ }

const karbonResult = await findOrCreateClient(...)   // ← unguarded
```

If the Karbon call throws, the exception escapes to the outer catch at line 225
and the `.update({ contact_id, link_method, … })` on line 156 **never runs** —
discarding the Hub contact that was just successfully created. The intake looks
unlinked even though the contact exists.

**Fix:** wrap `findOrCreateClient` in its own try/catch that degrades to
`hubFallback`, so the Hub-first invariant actually holds. Also persist the
failure — see F7.

### 🟠 F3 — Nothing durably links an intake to the booking it produced

`jotform_intake_submissions` has no `calendly_event_id`, no `meeting_id`, no
`deal_id`. Attribution today is an implicit join on `contact_id`, which only
works when the prospect books with the same email they typed on the form — and
only when F2 didn't eat the link.

That means the firm cannot answer "did this intake convert to a meeting?"
without a fuzzy query, which is why the 8% number above took SQL to find rather
than being on a dashboard.

**Fix:** add `calendly_event_id uuid` (+ `first_booked_at`) to the intake row and
populate it from the `salesforce_uuid` / UTM tracking value carried through F1.

### 🟠 F4 — An intake does not open a Deal

`findOrCreateDeal` is called from the Calendly webhook, `/api/calendly/book`,
`/api/prospects`, and the hub-meetings sync — but **not** from the intake
pipeline. A prospect who submits the form and never books has a contact and a
triage row but no opportunity, so they're invisible to the deals pipeline.

**Fix:** call `findOrCreateDeal({ contactId, source: "intake" })` in
`upsertIntakeSubmission` right after the contact resolves. It's already
idempotent — the Calendly webhook will reuse the same open deal.

### 🟠 F5 — A mail outage silently marks the intake as notified

`sendCategoryEmail` (lib/email.ts:1078) **swallows** delivery failures and
returns `{ sent: 0 }` rather than throwing. In `runIntakePostProcessing`
(ingest.ts:576-620) `notified_at` is stamped unconditionally after the call:

```ts
const { sent, attempted } = await notifyTeamOfNewIntake(...)
await supabase...update({ notified_at: new Date().toISOString() })   // even if sent === 0
```

If Resend is down or rate-limited, the team email for that prospect is lost
permanently and the single-flight guard prevents any retry.

**Fix:** only stamp `notified_at` when `sent > 0`; otherwise leave it null and
let a sweep retry. Also worth an alert when `sent < attempted`.

### 🟠 F6 — "A Zoom meeting is booked" is true ~77% of the time

The Discovery Meeting event type offers a phone option alongside Zoom:

| Event type | Zoom | Outbound call (no join URL) |
| --- | --- | --- |
| **Discovery Meeting (First Meeting with Motta)** | 37 | **11** |
| Client Check-In (30 min) | 14 | 3 |
| Client Touch Base (15 min) | 10 | 7 |

Those 11 discovery calls have no `join_url`, therefore no Zoom meeting, therefore
no recording, no transcript, no AI summary, and nothing for the Calendly→Zoom
bridge or the debrief flow to attach to. Everything downstream of the meeting
silently doesn't happen for them.

**Fix (Calendly config, not code):** if the intent is "discovery calls are always
Zoom", remove the phone option from that event type. If phone is deliberate,
accept that those meetings won't produce recordings and don't chase the bridge
gap.

### 🟡 F7 — No observability on intake linking failures

When linking fails, the only trace is `console.log("[Jotform] intake auto-link
error: …")` in a serverless log. There is no `link_error` column on the intake
row, and website submissions bypass `jotform_webhook_events` entirely (that
audit table is only written by the Jotform webhook receiver), so the website
path has no raw-delivery audit trail at all.

That is why F2 sat undetected: 11 unlinked rows produce zero visible signal.

**Fix:** persist `link_error` / `link_attempted_at` on the row; surface unlinked
intakes as a count on the `/intake` page next to the existing Jotform status card.

### 🟡 F8 — `docs/WEBSITE_INTEGRATION.md` documents the wrong intake contract

The doc tells the website team to POST a **nested** payload with an `_hp`
honeypot:

```json
{ "submitter": { "first_name": … }, "engagement": {…}, "business": {…}, "_hp": "" }
```

The route (`app/api/public/intake/route.ts:70-125`) accepts a **flat** payload
with a honeypot named `website`. The documented response
(`contact_id`, `organization_id`) is also wrong — the route returns only
`{ ok, submission_id }`.

Anyone integrating from the doc gets a row with every field null, which still
returns `200 ok`. (The contact-form half of the doc *is* accurate, and
`app/embed/intake/page.tsx` uses the correct flat shape — so this is doc drift,
not a code bug.)

**Fix:** rewrite §1's intake block to match the route, and consider returning
`contact_id` so the website can confirm the link landed.

### 🟡 F9 — Four supported fields the live form never collects

`behind_on_filings`, `pending_tax_notices`, `current_cpa_status`,
`cpa_switch_reason` are parsed (`lib/jotform/parse.ts:305-308`), stored,
selected in post-processing, and rendered in the team email
(`lib/jotform/notify.ts:214-217`) — but **no form collects them**. The wizard
doesn't ask, and real Jotform submissions never contained them.

These are high-signal qualifying questions ("are you behind on filings?",
"do you have an open IRS notice?") that would materially improve the fee
estimate and triage priority.

**Fix:** add them to the wizard as one optional step. Zero backend work required.

### 🟡 F10 — The Karbon work item is still a manual button

`createIntakeWorkItem` fires only when a teammate clicks in the detail sheet
(`components/intake/intake-detail-sheet.tsx:348`). Only 7 of 230 intakes have a
`karbon_work_item_key`.

That's arguably correct — you don't want a 1040 work item for every tyre-kicker.
But if the firm's rule is "every intake gets a prospect work item", it should
fire automatically on `lead_status → qualified`.

### 🟡 F11 — The Hub intake queue isn't being worked

Of 100 Jotform intakes in the last 12 months, **1** has a `lead_status` other
than `new`. The triage UI (status, owner, notes, action items, ALFRED draft
reply) exists and is well-built, but the team is evidently working from the
email, not the queue.

Worth deciding: either drive people into the queue (make the email CTA the only
path to the prospect's info) or accept the email as the product and stop
investing in triage state.

### 🟢 F12 — Two front doors, one should go

Both intake forms are live and accepting submissions. Every field mapping,
option vocabulary and question exists in two places. Pick the native form
(better UX, no third-party dependency, no per-submission API call) and disable
the Jotform one — or the reverse — but running both means every future change
gets made twice or, worse, once.

---

## 4. Recommended sequence

**Phase 1 — close the funnel leak (highest value)**
1. F1: booking step in the intake wizard + prospect confirmation email carrying
   the link, with `salesforce_uuid=<submission_id>` on the Calendly URL.
2. F3: persist `calendly_event_id` / `first_booked_at` on the intake row from
   that tracking value.
3. F6: decide Zoom-only vs. phone-allowed on the Discovery Meeting event type.

**Phase 2 — stop losing records**
4. F2: guard `findOrCreateClient`; fall back to the Hub contact.
5. F5: only stamp `notified_at` when `sent > 0`.
6. F7: persist `link_error`; surface an "unlinked intakes" count on `/intake`.

**Phase 3 — richer automation**
7. F4: open a Deal on intake.
8. F9: add the four qualifying questions to the wizard.
9. F10: auto-create the Karbon work item on qualification.

**Phase 4 — consolidate**
10. F8: fix `WEBSITE_INTEGRATION.md`.
11. F12: retire one of the two intake forms.
12. F11: decide whether the triage queue is the product or the email is.

---

## 5. What's already good and shouldn't change

- **The Hub-first invariant.** Contacts are created in Supabase before Karbon,
  so a Karbon outage can't lose a prospect. Right call. (F2 is a bug in the
  implementation, not the design.)
- **Single ingest path** for both front doors. The website route synthesizing a
  Jotform-shaped payload rather than forking the pipeline is the right trade.
- **Idempotency everywhere** — upsert on `jotform_submission_id`, dedupe ledger
  on the Calendly webhook, single-flight on `notified_at`,
  `karbon_work_item_key` short-circuit.
- **The ALFRED intake email.** Research brief + draft answer + fee estimate is a
  genuinely strong artifact.
- **The Calendly→Zoom bridge.** Deterministic (no model in the loop), idempotent,
  and it carries tags forward so nobody retags the same meeting twice.

---

## 6. Appendix — queries used

```sql
-- Intake → booking conversion (the headline number)
with i as (
  select id, contact_id, jotform_created_at
  from jotform_intake_submissions
  where jotform_created_at > now() - interval '18 months' and contact_id is not null
)
select
  count(*) as intakes_with_contact,
  count(*) filter (where exists (
    select 1 from calendly_invitees ci join calendly_events ce on ce.id = ci.calendly_event_id
    where ci.contact_id = i.contact_id
      and ce.created_at between i.jotform_created_at and i.jotform_created_at + interval '30 days'
  )) as booked_within_30d
from i;

-- Zoom coverage by event type
select name, location_type, count(*),
       count(*) filter (where join_url is not null) as with_join_url
from calendly_events
where start_time > now() - interval '180 days' and status = 'active'
group by 1, 2 order by 1;

-- Unlinked website intakes
select jotform_submission_id, jotform_created_at, link_method, contact_id
from jotform_intake_submissions
where jotform_form_id = 'website' and contact_id is null;
```
