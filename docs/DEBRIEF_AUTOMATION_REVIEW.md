# Debrief Form — Automation Review

**Date:** 2026-08-07
**Scope:** the debrief as the hinge of the pipeline — `Intake → Calendly → Zoom →
recording → Debrief → proposal`, all hanging off one Deal
**Method:** read of the live code paths plus queries against the Motta Hub
production database (`gylupzxitoebhqjnvzuw`).
**Companion:** `docs/INTAKE_AUTOMATION_REVIEW.md` (the intake half, Phases 1–3
of which are implemented).

---

## 0. TL;DR

The Debrief form is the most complete form in the Hub, and unlike the intake
queue it is genuinely used: **915 debriefs in 12 months**, about four per
business day, most recent yesterday. The team has adopted it.

But it is **not attached to anything**. The chain you describe exists as
columns and as code, and carries almost no data:

| Measure | Value |
| --- | --- |
| Debriefs (last 12 months) | 915 |
| …linked to a Calendly event | **0** |
| …linked to a Zoom meeting | **0** |
| …linked to a `meetings` row | **0** |
| …linked to a Deal | 271 (30%) |
| Client meetings in 180d that got a debrief | **0 of 91** |
| Zoom meetings in 180d with a transcript on file | 178 of 238 |
| …with an AI summary | 40 |
| `zoom_meeting_deals` rows | **0** |

Two consequences, and they're the whole review:

1. **The debrief is not a per-meeting artifact today — it's a per-work-item
   note.** 543 of 915 carry a `work_item_id`; none carries a meeting. So "a
   debrief for every meeting" is not currently measurable, let alone true.
2. **The one manual step is more manual than it needs to be.** 178 recent
   meetings have a transcript sitting in Supabase and not one character of it
   reaches the form. The partner types from memory next to a verbatim record of
   the conversation.

Nothing here is a rewrite. The columns exist (migration 332 added
`calendly_event_id` / `zoom_meeting_id`, 337 added `deal_id`), the prefill
helper exists, the API writes them correctly. The links are simply **opt-in via
a path nobody walks**, and the transcript was never wired up.

---

## 1. What the form does today

`components/debrief-form.tsx` — 1,869 lines, and genuinely thorough:

- **Primary contact** — auto-derived from the first selected work item's owning
  Karbon client, manually overridable. Drives `debriefs.contact_id` /
  `organization_id`.
- **Additional related clients** — de-duped against the primary.
- **Related Karbon work items** — multi-select.
- **Notes** — with @mentions (`MentionTextarea`).
- **Action items** — description, assignee, due date, priority, and a
  `create_task` checkbox per item.
- **Services** — Ignition service catalog picker, plus fee adjustment + reason.
  This is your "project finance / services to create the proposal".
- **Research topics**, **attachments** (25 MB cap, Vercel Blob), **notify team**
  with a recipient picker.

On submit (`app/api/debriefs/route.ts`): inserts the `debriefs` row, posts a
note to the Karbon timeline (`postDebriefNoteToKarbon`), and emails the team.

The supporting cast is real too: an hourly `debrief-reminder` cron emails the
host after every tagged meeting ends, with a prefilled `/debriefs/new?…` link
(`lib/debriefs/meeting-link.ts`), and it correctly resolves co-hosts and meeting
modality (Zoom / phone / in-person).

---

## 2. Findings, ranked by impact

### 🔴 D1 — Not one debrief is linked to the meeting it covers

0 of 915, on all three FK columns.

The plumbing is **complete and correct**. I traced it end to end:

| Step | Status |
| --- | --- |
| `buildDebriefPrefillPath` puts `calendly_event_id` / `zoom_meeting_id` in the URL | ✅ |
| The form reads them into `meetingLinkRef` on mount | ✅ |
| The POST body includes them (`components/debrief-form.tsx:832-838`) | ✅ |
| The API writes them (`app/api/debriefs/route.ts:239-242`) | ✅ |

Nothing is broken. The problem is that those params only exist if the user
**arrives via the prefilled link** — from a meeting's detail dialog, or from the
debrief-reminder email (25 sent in 180 days). Everyone else clicks "New Debrief",
lands on a bare `/debriefs/new`, and the meeting link is silently null.

So the link is opt-in on a path almost nobody takes, and the form never asks.

**Fix:** make the form ask. When it loads without a meeting param, show a
"Which meeting was this?" picker listing that contact's recent meetings that
don't yet have a debrief. Same data the reminder cron already queries. This is
the single highest-value change on the debrief side — every other item below
depends on knowing which meeting a debrief covers.

### 🔴 D2 — The Zoom recording and summary never reach the form

`components/debrief-form.tsx` mentions "zoom" five times, and all five are the
FK passthrough. The transcript, the AI summary, and the recording are not read,
not displayed, and not used to draft anything.

Meanwhile: **685 transcripts** on file, 178 of the last 180 days' Zoom meetings
have one, and `lib/zoom/summarize-transcript.ts` +
`lib/zoom/ingest-ai-summary.ts` already produce structured summaries. There's
even `lib/zoom/generate-meeting-todos.ts`.

This is the biggest unexploited asset in the Hub, and it maps exactly onto what
you said the debrief is for: internal notes, action items, follow-ups. All three
are derivable from a transcript as a **draft the partner edits** rather than
prose they type from memory.

**Fix:** when the debrief opens against a Zoom meeting, pull the transcript /
summary and pre-populate notes and action items, clearly marked as an
ALFRED draft. Keep the human in the loop — the partner's judgment about what
matters is the point of the step — but stop making them start from a blank box.

Note the asymmetry worth fixing first: 178 meetings have transcripts but only
**40** have summaries. The summariser isn't keeping up with the transcripts.

### 🟠 D3 — Multi work-item selection is display-only

The form lets you select several work items and shows them as chips. On save,
only the first survives as a real link:

```ts
work_item_id: relatedWorkItems.length > 0 ? toUuidOrNull(relatedWorkItems[0].id) : null
```

The rest go into the `action_items` JSONB blob — no FK, not queryable, invisible
to any join. And `deal_work_items` (a real join table, 145 rows, written only by
the Deal page's manual tagger) is never touched by the debrief.

**Fix:** a `debrief_work_items` join table, written from `related_work_items`;
mirror them onto `deal_work_items` when the debrief has a deal.

### 🟠 D4 — Neither form can create a Karbon work item from a template

You asked for this on both forms. Today:

| Surface | Select existing work items | Create from a template |
| --- | --- | --- |
| Prospect form | — | ✅ full picker (template + status + assignee + dates) |
| **Intake** (detail sheet) | ❌ | ❌ one hardcoded button |
| **Debrief** | ✅ multi-select | ❌ nothing |

The intake's button is pinned to a single template —
`INDIVIDUAL_1040_WORK_TEMPLATE_KEY = "4lgMRtcGXwDl"` — inherited verbatim from
the old Zap. Every intake prospect gets a 1040 work item or nothing, regardless
of whether they came in for bookkeeping, payroll, or an S-corp election.

The building blocks are all there and proven: `/api/karbon/work-templates`
returns the synced templates *and* the status taxonomy filtered by work type,
and `lib/karbon/create-work-item.ts` creates from any template. They're just
only wired to the prospect form.

**Fix:** extract the prospect form's picker into a shared component and mount it
on both the intake detail sheet and the debrief, allowing multiple work items
per submission.

### 🟠 D5 — The Deal stage never advances

`findOrCreateDeal` only ever writes `stage: 'new'`. Nothing in the codebase
advances it. The distribution:

| Stage | Deals | Have a debrief |
| --- | --- | --- |
| `debriefed` | 129 | 129 |
| `new` | 63 | 0 |
| `met` | 6 | 0 |
| `meeting_scheduled` / `won` / `lost` | **0** | — |

Those 129 weren't earned — `scripts/337_deals_model.sql` set them in a one-time
backfill (`when ranked.has_debrief then 'debriefed'`). Nothing has moved since.
No deal has ever reached `won` or `lost`, so the pipeline can't report on
conversion at all.

Migration 337 defines exactly the right state machine in its own comments
(`new → meeting_scheduled → met → debriefed → won/lost`). Nobody drives it.

**Fix:** advance on the events that already fire — Calendly `invitee.created` →
`meeting_scheduled`; meeting end → `met`; debrief submit → `debriefed`. Leave
`won` / `lost` manual (or drive from Ignition proposal acceptance).

Related: `source` is unreliable. 186 of 198 deals say `unknown` because the
backfill created an open deal for nearly every contact, and `findOrCreateDeal`
reuses any open deal without updating `source`. 0 deals say `calendly` despite
the webhook passing it.

### 🟠 D6 — `deal_id` can't reach the debrief from the meeting path

`buildDebriefPrefillPath` sets nine params. `deal_id` is not one of them — so
the reminder email and the meeting detail dialog structurally cannot carry it.
Only the Deal page's own "Run debrief" button does, which is why exactly 30% of
debriefs have a deal.

**Fix:** add `deal_id` to the prefill params and resolve it from the meeting's
contact when the caller doesn't supply one.

### 🟡 D7 — `zoom_meeting_deals` is empty

The table exists; nothing writes it. Zoom meetings reach a Deal only indirectly
via `meetings.deal_id` (114 of 541 rows).

### 🟡 D8 — Debrief reminders cover a quarter of meetings

25 reminders for 91 client meetings in 180 days. The cron only emails meetings
that are **tagged to a client** and not canceled — so an untagged meeting never
prompts anyone. Given ALFRED triage and the Calendly bridge both tag
automatically, the gap is worth a look; it may be the same 22 meetings that have
no Zoom link (see the intake review, F6).

### 🟡 D9 — Everything of substance lives in one JSONB blob

`debriefs.action_items` holds action items, primary contact, related clients,
related work items, **service lines**, research topics, fee adjustment,
attachments, notification recipients, and the team member name.

It's a reasonable way to avoid schema churn, but it means none of it is
queryable. "What did we quote across every debrief this quarter?" or "which
action items are overdue?" require JSON surgery. Given services are the input to
your proposals, they deserve real columns.

### 🟡 D10 — The services → proposal step dead-ends

The form collects Ignition services and a fee adjustment. Those land in the JSONB
blob and get rendered in the team email. **Nothing creates a proposal.** The
Ignition integration is read-only — `lib/ignition/sync.ts` pulls proposals in;
nothing pushes one out.

So the last mile of "the debrief produces the proposal" is a human re-keying the
selected services into Ignition by hand. Worth checking whether Ignition's API
supports proposal creation for your plan — if it does, this is the second-biggest
automation win on this form after the transcript.

---

## 3. What the target chain looks like

You described it as one Deal spanning the whole journey. Here's the gap, per hop:

| Hop | Mechanism | State |
| --- | --- | --- |
| Intake → Hub contact | `findOrCreateHubContact` | ✅ fixed this week |
| Intake → Karbon | direct v3 API (not Zaps) | ✅ |
| Intake → Deal | `findOrCreateDeal(source: intake_form)` | ✅ added this week |
| Intake → Calendly booking | prefilled link + `salesforce_uuid` | ✅ added this week |
| Calendly → Zoom meeting | Calendly's native Zoom integration | ✅ (77% — see F6) |
| Zoom → recording / transcript | `sync-account-recordings`, `parse-vtt` | ✅ 178/238 |
| Zoom ↔ Calendly | `bridge-to-calendly` by `/j/<id>` | ✅ 62 of 238 |
| **Meeting → Debrief** | prefill link only | ❌ **0 of 915** |
| **Recording → Debrief prefill** | — | ❌ **doesn't exist** |
| **Debrief → Deal** | manual, Deal page only | ⚠️ 30% |
| **Deal stage advance** | — | ❌ **frozen since a backfill** |
| **Debrief → proposal** | — | ❌ **manual re-key** |

The first three-quarters of the chain is built. It falls apart precisely at the
step you called critical.

---

## 4. Recommended sequence

**Phase A — attach the debrief to reality** (unblocks everything else)
1. D1: meeting picker on the debrief when no meeting param is present.
2. D6: carry `deal_id` through the prefill; resolve from the meeting otherwise.
3. D5: advance the Deal stage on booking / meeting-end / debrief.

**Phase B — make the manual step smaller**
4. D2: pre-populate notes + action items from the Zoom transcript / summary.
5. Close the transcript→summary gap (178 transcripts, 40 summaries).

**Phase C — the Karbon work-item ask**
6. D4: shared template picker + multi-create on both the intake and the debrief.
7. D3: `debrief_work_items` join table; mirror onto `deal_work_items`.

**Phase D — the proposal**
8. D10: confirm Ignition proposal-creation API access, then draft the proposal
   from the debrief's selected services.
9. D9: promote service lines (at minimum) out of the JSONB blob.

---

## 5. What's already good and shouldn't change

- **The form's information architecture.** Primary contact vs. related clients
  vs. work items is the right decomposition, and auto-deriving the primary from
  the work item's Karbon owner is a genuinely nice touch.
- **Adoption.** 915 debriefs in 12 months with no enforcement is the hard part,
  and it's already solved. Everything above is plumbing around a habit the team
  already has.
- **`lib/debriefs/meeting-link.ts`.** Framework-agnostic, handles co-host
  resolution and maps Calendly's messy `location_type` vocabulary onto three
  clean modalities. The prefill contract is right — it's just under-used.
- **The reminder cron.** Correct trigger, correct recipients, idempotent via
  `debrief_requested_at`.

---

## 6. Appendix — queries used

```sql
-- The headline: debriefs are attached to nothing
select count(*) as total,
       count(*) filter (where calendly_event_id is not null) as with_calendly,
       count(*) filter (where zoom_meeting_id  is not null) as with_zoom,
       count(*) filter (where meeting_id       is not null) as with_meeting,
       count(*) filter (where deal_id          is not null) as with_deal
from debriefs where deleted_at is null;

-- Meeting → debrief coverage
select count(*) as meetings_180d,
       count(*) filter (where exists (
         select 1 from debriefs d
          where d.calendly_event_id = ce.id and d.deleted_at is null)) as debriefed
from calendly_events ce
where ce.start_time between now() - interval '180 days' and now()
  and ce.status = 'active';

-- The unexploited transcript asset
select (select count(*) from zoom_transcripts)       as transcripts,
       (select count(*) from zoom_meeting_summaries) as summaries;

-- Deal stages are frozen where migration 337 left them
select stage, status, count(*) from deals group by 1,2 order by 3 desc;
```
