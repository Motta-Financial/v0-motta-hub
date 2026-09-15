# Client portal — v0 prompts, one place

Supersedes `docs/v0-prompts-queue.md` and the prompt sections of
`docs/portal-v0-task-briefs.md`. Verified against the codebase, the live
database and the v0 branches. Last pass: 2026-09-14.

**Of the 13 prompts in the original two docs, 12 are now built.** The originals
went stale because they were written as queues and then worked through without
being updated. Check the status table before asking v0 for anything.

---

# Status

| Prompt | State |
|---|---|
| PreviewFeature wrapper | Built — `components/shared/preview-feature.tsx` |
| Plain-English statuses | Built — `lib/portal/client-status.ts` |
| Conversation search | Built — portal messages page |
| Collapsible sidebar | Built — `lib/hooks/use-sidebar-collapsed.ts`, both apps |
| Document checklist, staff | Built — `components/clients/document-request-checklist-staff.tsx` |
| Document checklist, client | Built — `components/portal/document-request-checklist-client.tsx` |
| Client timeline | Built — `components/clients/client-timeline-tab.tsx` |
| Change requests panel | Built — `components/clients/change-requests-panel.tsx` |
| Meetings page | Built — on mock data |
| Latest meeting card | Built — on mock data |
| Tax returns archive | Built — on mock data |
| Compose expectations | Built — see below |
| Staff Messages sub-tab | Built and **wired to real data** 2026-09-14 |
| Email triage tab | Built — on mock data, behind PreviewFeature |
| Emails assign-to-project | Built — predates the prompt |
| Alfred in the portal | Not started, deliberately later |

Two corrections worth recording, because both were the same mistake — grepping
for a filename or a string instead of reading the component:

- **Compose expectations** was never undone. `hasTeamReply`
  (`app/client-portal/(portal)/messages/page.tsx:71`) already gates the
  reply-time promise so it shows only once a team member has replied, and the
  urgent-contact note already renders above the thread at line 181.
- **Emails assign-to-project** was already complete. `EmailThreadDetail` had the
  dropdown, the Unassigned option and the removable chip; `EmailThreadsCard` had
  the All / Unassigned / by-project filter and subject+body search. v0 ran the
  prompt anyway and rewrote the working component — that commit was dropped.

---

# What actually remains

None of it is v0 work. Every remaining item is backend wiring or a decision.

## 1. Email — the whole integration

No Microsoft Graph integration exists in the repo, and the `emails` table has
**0 rows** in prod (checked 2026-09-13) — the Karbon backfill it was designed
for never ran. So both email surfaces are shells:

- The triage Emails tab reads `lib/mock/client-emails.ts` behind PreviewFeature.
- The client-profile Emails sub-tab reads generated sample threads.

Needs: Entra app registration, delegated mail scopes, per-user tokens,
incremental sync, and matching each message to a client by address. Sync from
Outlook directly — pulling mail out of Karbon rebuilds the dependency we're
deleting.

When the real mail lands, also move the triage Emails tab's **Clear** from local
`useState` (`dismissedEmailIds`) to `/api/triage/dismiss` with
`source_type: 'client_email'`, or Clear won't survive a refresh. Every other
source in that feed already persists.

## 2. Meetings and the latest-meeting card

Reading `lib/mock/meetings.ts`. Real data exists — `zoom_meetings`,
`debriefs_full`, `calendly_events`, recordings in blob storage.

Blocked on a decision, not code: debriefs contain internal notes — fee
adjustments, candid client commentary. **Do not pipe `debriefs.notes` to the
client.** Needs a separate client-facing summary field staff fill in or approve,
or a per-debrief "share with client" flag.

## 3. Tax returns archive

Reading `lib/mock/tax-returns-archive.ts`. Needs the approval record: when a
client approves a return, store the exact text shown, who clicked, when, from
what IP, append-only — not a boolean on a row. Same mechanism the
compliance/consent conversation needs; build once, use twice. Wording is
James's call.

## 4. Change requests

Reading `lib/mock/change-requests.ts`. Both halves already exist:
`contact_update_suggestions` with a full API and an admin page at
`/admin/contact-updates`. The portal currently sends a detail change as a chat
message instead of creating a suggestion row. Two-line change in the portal
route, worth doing regardless of the UI.

## 5. Document checklist

The client's per-document note has no column anywhere and needs one. The
checklist maps onto `tax_input_sets` / `tax_input_documents` /
`tax_input_field_defs` (`scripts/361_tax_intake.sql`); the portal must read
those through the service role because they hold SSNs.

## 6. Seen receipts on portal messages

`portal_messages` has no `read_at` column, so the "Seen" marker the mock showed
was never backed by anything. Restoring it needs a migration plus a write from
the portal when a client opens the thread.

---

# If you do send another prompt to v0

Two lines that came out of this round, both worth keeping in every prompt:

```
If this surface renders mock or sample data on a screen firm staff use, wrap it in the existing PreviewFeature component (components/shared/preview-feature.tsx) so nobody mistakes sample content for something a real client actually said or did.
```

```
Use the Tailwind tokens the component already uses. The palette below is for new elements only — do not convert existing semantic classes to hardcoded hex.
```

The first one worked: the triage Emails tab came back correctly wrapped, with a
mock file that documents its own ids as fake. The second is the fix for the
commit that converted `border-primary bg-primary` into inline hex.

And give v0 the file it's extending. The triage prompt succeeded partly because
`triage-feed.tsx` was named in it — without that, a 1,353-line feed is exactly
the kind of thing v0 rebuilds alongside rather than inside.
