/**
 * Shared Calendly booking pipeline.
 *
 * Two code paths learn about a booking:
 *
 *   • the real-time webhook (`app/api/calendly/webhook/route.ts`), and
 *   • the 30-minute polling sync (`lib/calendly-sync.ts`).
 *
 * Everything that has to happen once a booking is known — work out whose
 * calendar it is, make sure the invitee exists as a Hub contact, tie the
 * booking back to the intake form that produced it, tell the firm, move
 * the prospect's Karbon work item to "meeting scheduled" — lives here so
 * both paths do exactly the same thing.
 *
 * That matters because the webhook is not a guarantee. For its first
 * months in production the handler read the payload in the wrong shape
 * and silently dropped every delivery: bookings still reached the Hub
 * through the sync, but none of the follow-ups ran, so no team email was
 * ever sent and no booking was ever attributed to its intake (which in
 * turn sent "still want to talk?" nudges to prospects who had already
 * booked). The sweep at the bottom of this file is the backstop that
 * makes a repeat of that impossible: whatever the webhook misses, the
 * next sync picks up.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import type { CalendlyConnectionRow } from "@/lib/calendly-api"
import {
  extractPhoneFromInvitee,
  matchInviteeToContact,
  upsertAutoClientLink,
} from "@/lib/calendly-invitee-match"
import { findOrCreateHubContact } from "@/lib/hub/find-or-create-contact"
import { findOrCreateDeal } from "@/lib/deals/find-or-create-deal"
import { advanceDealStage } from "@/lib/deals/advance-stage"
import { pushHubContactToKarbon } from "@/lib/karbon/client-sync"
import { notifyTeamOfNewBooking, type NotifyBookingResult } from "@/lib/calendly/notify"
import { advanceLeadWorkItemsOnBooking } from "@/lib/karbon/finalize-work-item"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/* ─────────────────────────────────────────────────────────────────────────
 * Webhook payload shape
 * ─────────────────────────────────────────────────────────────────────── */

export interface NormalizedBooking {
  /** The Calendly `scheduled_event` resource. */
  scheduledEvent: Record<string, any>
  /** The Calendly `invitee` resource, or null when the payload had none. */
  invitee: Record<string, any> | null
}

/**
 * Pull the scheduled event and the invitee out of an `invitee.created` /
 * `invitee.canceled` webhook payload.
 *
 * Calendly's Webhooks v2 payload IS the invitee, with the event nested
 * under `scheduled_event` — and, confusingly, an `event` key that is only
 * the event's URI string:
 *
 *   { uri: ".../invitees/X", email, name, questions_and_answers, tracking,
 *     event: "https://api.calendly.com/scheduled_events/Y",
 *     scheduled_event: { uri, name, start_time, event_memberships, … } }
 *
 * The original handler destructured `{ event, invitee }` (the v1 shape),
 * got a string and `undefined`, and dropped the delivery. The nested
 * `{ event: {…}, invitee: {…} }` shape is still accepted so hand-built
 * payloads and replays keep working.
 */
export function normalizeInviteeWebhookPayload(payload: unknown): NormalizedBooking | null {
  if (!payload || typeof payload !== "object") return null
  const p = payload as Record<string, any>

  if (p.scheduled_event && typeof p.scheduled_event === "object" && p.scheduled_event.uri) {
    // Keep the invitee lean: the event is stored on its own row.
    const { scheduled_event: scheduledEvent, ...invitee } = p
    return { scheduledEvent, invitee: invitee.uri ? invitee : null }
  }

  if (p.event && typeof p.event === "object" && p.event.uri) {
    const invitee = p.invitee && typeof p.invitee === "object" && p.invitee.uri ? p.invitee : null
    return { scheduledEvent: p.event, invitee }
  }

  return null
}

/* ─────────────────────────────────────────────────────────────────────────
 * Host resolution
 * ─────────────────────────────────────────────────────────────────────── */

export interface ResolvedHost {
  /**
   * An ACTIVE Hub connection for one of the event's hosts, when there is
   * one — its token is what follow-up Calendly API calls must use.
   */
  connection: CalendlyConnectionRow | null
  /** Hub teammate the meeting belongs to, however we managed to tell. */
  teamMemberId: string | null
  /** Primary host identity as Calendly reports it (`event_memberships[0]`). */
  userUri: string | null
  userName: string | null
  userEmail: string | null
}

/** Teammate lookup tables, loadable once and reused across many events. */
export interface HostDirectory {
  connectionsByUri: Map<string, CalendlyConnectionRow>
  teamMemberIdByEmail: Map<string, string>
}

export async function loadHostDirectory(supabase: SupabaseClient): Promise<HostDirectory> {
  const directory: HostDirectory = {
    connectionsByUri: new Map(),
    teamMemberIdByEmail: new Map(),
  }
  try {
    const [{ data: connections }, { data: teamMembers }] = await Promise.all([
      // EVERY connection row, active or not: a lapsed OAuth token doesn't
      // change which teammate a Calendly user is.
      supabase.from("calendly_connections").select("*"),
      supabase.from("team_members").select("id, email, status"),
    ])
    for (const c of (connections ?? []) as CalendlyConnectionRow[]) {
      if (!c.calendly_user_uri) continue
      const existing = directory.connectionsByUri.get(c.calendly_user_uri)
      // Prefer the active row when a user has reconnected.
      if (!existing || (c.is_active && !existing.is_active)) {
        directory.connectionsByUri.set(c.calendly_user_uri, c)
      }
      // The Calendly login email is also a reliable key for that teammate,
      // including when it differs from their Hub email.
      if (c.calendly_user_email && c.team_member_id) {
        directory.teamMemberIdByEmail.set(c.calendly_user_email.toLowerCase(), c.team_member_id)
      }
    }
    // Hub emails win over connection emails on a clash; active teammates
    // win over former ones.
    const members = [...(teamMembers ?? [])].sort(
      (a, b) => Number(a.status === "active") - Number(b.status === "active"),
    )
    for (const tm of members) {
      if (tm.email) directory.teamMemberIdByEmail.set(String(tm.email).toLowerCase(), tm.id as string)
    }
  } catch (err) {
    console.error("[calendly] host directory load failed:", err)
  }
  return directory
}

/**
 * Work out whose meeting this is.
 *
 * Clients can book on anyone's calendar — including teammates who never
 * connected Calendly to the Hub, or whose connection has lapsed — so the
 * host cannot be assumed to have an active connection. Resolution, in
 * order, across every host on the event:
 *
 *   1. an active connection for that Calendly user;
 *   2. any connection row for that user (maps the user to a teammate even
 *      when the token is dead);
 *   3. a teammate whose email matches the host's Calendly email.
 *
 * The primary host is `event_memberships[0]`; co-hosts are only consulted
 * for the teammate link when the primary can't be placed.
 */
export function resolveEventHost(
  scheduledEvent: Record<string, any> | null | undefined,
  directory: HostDirectory,
): ResolvedHost {
  const memberships: Array<Record<string, any>> = Array.isArray(scheduledEvent?.event_memberships)
    ? scheduledEvent!.event_memberships
    : []
  const primary = memberships[0] ?? {}

  let connection: CalendlyConnectionRow | null = null
  let teamMemberId: string | null = null

  for (const membership of memberships) {
    const uri = typeof membership?.user === "string" ? membership.user : null
    const email = typeof membership?.user_email === "string" ? membership.user_email.toLowerCase() : null
    const conn = uri ? (directory.connectionsByUri.get(uri) ?? null) : null

    if (conn?.is_active && !connection) connection = conn
    if (!teamMemberId) {
      teamMemberId =
        conn?.team_member_id ?? (email ? (directory.teamMemberIdByEmail.get(email) ?? null) : null)
    }
  }

  return {
    connection,
    teamMemberId,
    userUri: (primary.user as string | undefined) ?? null,
    userName: (primary.user_name as string | undefined) ?? null,
    userEmail: (primary.user_email as string | undefined) ?? null,
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Invitee → Hub contact
 * ─────────────────────────────────────────────────────────────────────── */

export interface InviteeContactResolution {
  contactId: string | null
  matchMethod: "email" | "name_phone" | "name" | null
  /** True when this booking created the Hub contact. */
  wasNewContact: boolean
}

/**
 * Make sure the person who booked exists in the Hub and is tied to the
 * meeting and to an open deal.
 *
 * Match first (email → name+phone → unique name). On a miss, create a
 * Hub contact: a Calendly booking is one of the three canonical ways a
 * prospect enters the Hub (alongside the intake form and Zoom), so every
 * invitee should exist as a contact whether or not anyone has linked them
 * by hand. New contacts are pushed to Karbon via `defer`.
 *
 * Never throws — an unlinked meeting is better than a lost one.
 */
export async function resolveInviteeContact(
  supabase: SupabaseClient,
  invitee: { email?: string | null; name?: string | null; phone?: string | null },
  calendlyEventId: string | null,
  options: { defer?: (task: () => Promise<unknown>) => void } = {},
): Promise<InviteeContactResolution> {
  const defer =
    options.defer ??
    ((task: () => Promise<unknown>) => {
      void task().catch(() => {})
    })

  let contactId: string | null = null
  let matchMethod: InviteeContactResolution["matchMethod"] = null
  let wasNewContact = false

  try {
    const match = await matchInviteeToContact(supabase, {
      email: invitee.email,
      name: invitee.name,
      phone: invitee.phone,
    })
    contactId = match?.contactId ?? null
    matchMethod = match?.matchMethod ?? null
  } catch (err) {
    console.error("[calendly] invitee match failed (non-blocking):", err)
  }

  if (!contactId && (invitee.email || invitee.name)) {
    try {
      const created = await findOrCreateHubContact(
        {
          email: invitee.email ?? null,
          fullName: invitee.name ?? null,
          phone: invitee.phone ?? null,
        },
        { source: "calendly", supabase, skipInternal: true },
      )
      if (created.contact_id) {
        contactId = created.contact_id
        wasNewContact = !!created.created
        // `calendly_event_clients.match_method` is a constrained enum with
        // no "auto_created"; email was the signal the contact was built on.
        matchMethod = "email"
        console.log(
          `[calendly] hub auto-${created.created ? "created" : "matched"} contact ${created.contact_id}: ${created.reason}`,
        )
        if (wasNewContact) {
          const newContactId = contactId
          // Direct Calendly bookings (prospects who skipped the intake
          // form) still need to land in Karbon.
          defer(() =>
            pushHubContactToKarbon(newContactId, { source: "Calendly Booking" }).catch((err) => {
              console.error("[calendly] karbon push failed (non-blocking):", err)
            }),
          )
        }
      }
    } catch (err) {
      console.error("[calendly] hub auto-create failed (non-blocking):", err)
    }
  }

  if (contactId && calendlyEventId) {
    await upsertAutoClientLink(supabase, {
      calendlyEventId,
      contactId,
      matchMethod: matchMethod ?? "email",
    })

    // Open (or reuse) the contact's single open Deal, and mark it
    // `meeting_scheduled`. Monotonic: a second booking on an already
    // debriefed deal is a no-op rather than a regression.
    try {
      const deal = await findOrCreateDeal(
        {
          contactId,
          title: invitee.name ?? invitee.email ?? "Calendly Prospect",
          source: "calendly",
        },
        { supabase },
      )
      const moved = await advanceDealStage(supabase, deal.deal_id, "meeting_scheduled")
      if (moved.advanced) console.log(`[calendly] deal ${deal.deal_id} stage ${moved.reason}`)
    } catch (err) {
      console.error("[calendly] deal create failed (non-blocking):", err)
    }
  }

  return { contactId, matchMethod, wasNewContact }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Intake → booking attribution
 * ─────────────────────────────────────────────────────────────────────── */

/** The intake row id an invitee's tracking data points at, if any. */
export function intakeIdFromTracking(tracking: unknown): string | null {
  const raw = (tracking as { salesforce_uuid?: unknown } | null | undefined)?.salesforce_uuid
  if (typeof raw !== "string") return null
  const id = raw.trim()
  // Guard the shape before it reaches Postgres: a non-uuid value in a
  // uuid comparison is a 22P02 error, not a no-op.
  return UUID_RE.test(id) ? id : null
}

/**
 * Attribute a booking back to the intake submission that produced it.
 *
 * The intake pipeline hands each prospect a Calendly link carrying
 * `salesforce_uuid=<jotform_intake_submissions.id>` (lib/intake/
 * booking-link.ts); Calendly round-trips it into `invitee.tracking`. So a
 * booking made from an intake link says exactly which intake it came
 * from — no email-matching heuristics.
 *
 * First booking wins: `.is("calendly_event_id", null)` means a reschedule
 * or a second meeting never overwrites the original conversion.
 *
 * Returns the intake id when the tracking named one (attributed now or
 * earlier), else null.
 */
export async function attributeBookingToIntake(
  supabase: SupabaseClient,
  tracking: unknown,
  calendlyEventId: string,
  bookedAt: string | null,
): Promise<string | null> {
  const intakeId = intakeIdFromTracking(tracking)
  if (!intakeId) return null

  const { data, error } = await supabase
    .from("jotform_intake_submissions")
    .update({
      calendly_event_id: calendlyEventId,
      first_booked_at: bookedAt ?? new Date().toISOString(),
    })
    .eq("id", intakeId)
    .is("calendly_event_id", null)
    .select("id")

  if (error) {
    console.error("[calendly] intake attribution failed:", error.message)
  } else if (data && data.length > 0) {
    console.log(`[calendly] attributed booking to intake ${intakeId}`)
  }
  return intakeId
}

/**
 * Attribute every booking whose invitee carries an intake tracking id but
 * whose intake row is still unattributed.
 *
 * Runs on each sync. It is what repairs the history the broken webhook
 * left behind, and it keeps attribution correct for any booking the
 * webhook misses from here on. Idempotent and cheap: only invitees that
 * arrived through an intake link carry the tracking id.
 */
export async function backfillIntakeAttribution(supabase: SupabaseClient): Promise<number> {
  let attributed = 0
  try {
    const { data: invitees, error } = await supabase
      .from("calendly_invitees")
      .select("calendly_event_id, tracking, status, calendly_created_at")
      .not("tracking->>salesforce_uuid", "is", null)
      .not("calendly_event_id", "is", null)
      // Oldest first, so "first booking wins" holds across the batch.
      .order("calendly_created_at", { ascending: true })
      .limit(1000)
    if (error) throw error

    const pending = new Map<string, { eventId: string; bookedAt: string | null }>()
    for (const row of invitees ?? []) {
      if (row.status === "canceled") continue
      const intakeId = intakeIdFromTracking(row.tracking)
      if (intakeId && !pending.has(intakeId)) {
        pending.set(intakeId, {
          eventId: row.calendly_event_id as string,
          bookedAt: (row.calendly_created_at as string | null) ?? null,
        })
      }
    }
    if (pending.size === 0) return 0

    const { data: open } = await supabase
      .from("jotform_intake_submissions")
      .select("id")
      .in("id", Array.from(pending.keys()))
      .is("calendly_event_id", null)

    for (const intake of open ?? []) {
      const hit = pending.get(intake.id as string)
      if (!hit) continue
      const { data: updated, error: updErr } = await supabase
        .from("jotform_intake_submissions")
        .update({ calendly_event_id: hit.eventId, first_booked_at: hit.bookedAt })
        .eq("id", intake.id)
        .is("calendly_event_id", null)
        .select("id")
      if (updErr) {
        console.error("[calendly] intake attribution backfill failed:", updErr.message)
      } else if (updated && updated.length > 0) {
        attributed += 1
      }
    }
    if (attributed > 0) console.log(`[calendly] attributed ${attributed} booking(s) to their intake`)
  } catch (err) {
    console.error("[calendly] intake attribution backfill crashed (non-fatal):", err)
  }
  return attributed
}

/* ─────────────────────────────────────────────────────────────────────────
 * Follow-ups once a booking is on file
 * ─────────────────────────────────────────────────────────────────────── */

export interface BookingFollowUpResult {
  email: NotifyBookingResult
  karbonAdvanced: string[]
}

/**
 * The outward-facing consequences of a new booking:
 *
 *   1. the firm-wide "New Meeting Booked" email, with ALFRED's brief;
 *   2. moving the prospect's Hub-created Karbon tax work item on to
 *      "Lead | Meeting Schd" (only from a pre-meeting lead status).
 *
 * Both are idempotent, so the webhook and the sweep can each call this
 * for the same booking without doubling anything. Never throws.
 */
export async function runBookingFollowUps(
  supabase: SupabaseClient,
  booking: {
    eventId: string
    contactId?: string | null
    intakeSubmissionId?: string | null
    wasNewContact?: boolean
  },
): Promise<BookingFollowUpResult> {
  const email = await notifyTeamOfNewBooking({
    eventId: booking.eventId,
    wasNewContact: booking.wasNewContact,
  }).catch((err): NotifyBookingResult => {
    console.error("[calendly] team email failed (non-blocking):", err)
    return { sent: false, recipientCount: 0, reason: "error" }
  })

  let karbonAdvanced: string[] = []
  try {
    const advanced = await advanceLeadWorkItemsOnBooking(supabase, {
      contactId: booking.contactId ?? null,
      intakeSubmissionId: booking.intakeSubmissionId ?? null,
    })
    karbonAdvanced = advanced.advanced
  } catch (err) {
    console.error("[calendly] karbon lead status update failed (non-blocking):", err)
  }

  return { email, karbonAdvanced }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Backstop sweep (runs at the end of every sync)
 * ─────────────────────────────────────────────────────────────────────── */

/**
 * Only bookings made this recently are announced by the sweep. This is
 * the guard that makes the backstop safe to switch on: every historical
 * `calendly_events` row has `team_notified_at IS NULL` (no email was ever
 * sent), and without a recency bound the first run would email the firm
 * about hundreds of old meetings.
 */
const SWEEP_LOOKBACK_HOURS = 24
/** Give the webhook's own follow-ups time to finish before stepping in. */
const SWEEP_GRACE_MINUTES = 5
/** Hard cap per run — each announcement is a research pass plus an all-staff email. */
const SWEEP_MAX_PER_RUN = 8

export interface BookingSweepResult {
  candidates: number
  announced: number
  skipped: number
  errors: string[]
}

/**
 * Announce any recent booking the webhook did not.
 *
 * A booking qualifies when it is active, still in the future, was made in
 * the last 24 hours (but not the last 5 minutes), and has not been
 * announced. For each one the full webhook pipeline is replayed from the
 * rows the sync just wrote: resolve the invitee to a Hub contact (creating
 * one if needed), attribute the intake, then send the email and update
 * Karbon. The email's atomic claim on `team_notified_at` means a webhook
 * that is merely slow cannot cause a duplicate.
 */
export async function announceUnnotifiedBookings(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<BookingSweepResult> {
  const result: BookingSweepResult = { candidates: 0, announced: 0, skipped: 0, errors: [] }

  try {
    const bookedAfter = new Date(now.getTime() - SWEEP_LOOKBACK_HOURS * 3_600_000).toISOString()
    const bookedBefore = new Date(now.getTime() - SWEEP_GRACE_MINUTES * 60_000).toISOString()

    const { data: events, error } = await supabase
      .from("calendly_events")
      .select("id, calendly_created_at")
      .is("team_notified_at", null)
      .eq("status", "active")
      .gt("start_time", now.toISOString())
      .gte("calendly_created_at", bookedAfter)
      .lte("calendly_created_at", bookedBefore)
      .order("calendly_created_at", { ascending: true })
      .limit(SWEEP_MAX_PER_RUN)
    if (error) throw error

    result.candidates = events?.length ?? 0

    for (const event of events ?? []) {
      const eventId = event.id as string
      try {
        const { data: invitees } = await supabase
          .from("calendly_invitees")
          .select("id, name, email, status, contact_id, tracking, text_reminder_number, questions_answers")
          .eq("calendly_event_id", eventId)
          .order("calendly_created_at", { ascending: true })

        const invitee =
          (invitees ?? []).find((i) => (i.status ?? "active") === "active") ?? null
        if (!invitee) {
          // Invitees not synced yet — the next run will have them.
          result.skipped += 1
          continue
        }

        let contactId = (invitee.contact_id as string | null) ?? null
        let wasNewContact: boolean | undefined
        if (!contactId) {
          // The sync only MATCHES existing contacts; the webhook is what
          // normally creates one. Do the webhook's job for it.
          //
          // Deferred work (the Karbon push for a brand-new contact) is
          // collected and awaited right here: the cron has the time
          // budget, there is no response waiting on it, and a promise
          // left floating in a serverless function is not guaranteed to
          // finish.
          const deferred: Array<Promise<unknown>> = []
          const resolved = await resolveInviteeContact(
            supabase,
            {
              email: invitee.email as string | null,
              name: invitee.name as string | null,
              phone: extractPhoneFromInvitee({
                text_reminder_number: invitee.text_reminder_number,
                questions_and_answers: invitee.questions_answers,
              }),
            },
            eventId,
            { defer: (task) => void deferred.push(task().catch(() => {})) },
          )
          contactId = resolved.contactId
          wasNewContact = resolved.wasNewContact
          if (contactId) {
            await supabase
              .from("calendly_invitees")
              .update({ contact_id: contactId, updated_at: new Date().toISOString() })
              .eq("id", invitee.id)
          }
          await Promise.allSettled(deferred)
        }

        const intakeSubmissionId = await attributeBookingToIntake(
          supabase,
          invitee.tracking,
          eventId,
          (event.calendly_created_at as string | null) ?? null,
        )

        const followUps = await runBookingFollowUps(supabase, {
          eventId,
          contactId,
          intakeSubmissionId,
          wasNewContact,
        })
        if (followUps.email.sent) result.announced += 1
        else result.skipped += 1
      } catch (err) {
        result.errors.push(`${eventId}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    if (result.candidates > 0) {
      console.log(
        `[calendly] booking sweep: ${result.announced} announced, ${result.skipped} skipped, ${result.errors.length} errors of ${result.candidates}`,
      )
    }
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err))
    console.error("[calendly] booking sweep crashed (non-fatal):", err)
  }
  return result
}
