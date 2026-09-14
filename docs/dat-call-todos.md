# To-dos from the Dat call (2026-09-04)

---

TASK: Alfred dry-run on a filed 2025 return
Pick a client who already sent us everything and whose 2025 return is filed — the
filed copy is the answer key. Set up a fresh tax prep project as if we knew
nothing: intake, document requests, debrief, all collected from scratch through
the portal. Note every point where you had to leave the portal to get something
done. Then have Alfred prep the return from those inputs only and diff it against
the filed copy: what it got right, what it got wrong, what it needed and never
asked for. Write the results into docs/portal-v0-task-briefs.md — the missing
documents into task 3, whatever Alfred needed a human for into task 7. Nothing
gets filed or sent to the client.

TASK: Outlook email sync, then Gmail
Confirm the Microsoft admin access Dat granted actually reaches app
registrations. Register the app in Entra: hub.motta.cpa redirect URI, Graph mail
and calendar scopes, tenant admin consent, client secret into Vercel env for
mottahub, then redeploy. Point the ready code at it and get one mailbox syncing
end to end before opening it up. Then let a thread be attached to a project —
that's Micaela's triage, and it goes in the existing Communications > Emails
sub-tab, not a new top-level tab. Sync from Outlook directly; pulling mail out of
Karbon rebuilds the dependency we're deleting. Gmail is the same shape once
Outlook works.

TASK: SSO — but fix the staff-vs-client identity split first
Portal clients get `authenticated` sessions in the Hub's own Supabase and ~105
RLS policies use USING(true), so they can't tell a client from staff. SSO doesn't
fix that and makes it harder if clients sign in the same way. Decide how a client
is distinguished from staff at the session level and fix the policies — this
blocks the portal pilot regardless. Then decide whether SSO replaces
email+password or sits beside it: replacing means we store no credentials at all,
keeping both means clients without a Microsoft or Google account can still get
in. Check we can create Entra registrations and a Google OAuth consent screen;
Dat will grant what's missing.

TASK: Close Dat's daily loop — calendar in the Hub, and what Karbon still does
He opens Google Calendar, then Karbon for startup, ignition and triage. Sync both
calendars into the Hub using the scopes from the email app registrations. In
parallel, sit with the people who use Karbon triage and ignition daily and write
down every job those screens do, with a yes/no on whether the Hub covers it. That
checklist is the bar for cutting Karbon; without it we'll cut too early.

TASK: Queue everything that needs Dat before Sept 9
He's back Sept 9, school starts, and he may not be in huddles — reachable when
pinged, not in the room. Send anything needing his access, approval or context
before then. Also: he said he'd send something "in two seconds" at the end of the
call and never named it. Ask if it didn't arrive.
