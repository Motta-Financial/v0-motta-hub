/**
 * "Has this person booked a meeting with us?"
 *
 * A direct, dependency-free check against the synced Calendly tables, for
 * callers that must not act on a prospect who has already booked — today
 * the intake booking nudge (lib/intake/booking-nudge.ts).
 *
 * The nudge used to rely solely on `jotform_intake_submissions.
 * calendly_event_id`, which is only as good as the attribution that
 * writes it. While that attribution was broken, 17 of the 24 nudges ever
 * sent went to prospects who had ALREADY booked. This check looks at the
 * bookings themselves, so the nudge stays correct even when a booking
 * can't be tied back to the intake row (different email on the booking
 * form, booked from a link without the tracking id, …).
 */

import type { SupabaseClient } from "@supabase/supabase-js"

const DAY_MS = 24 * 60 * 60 * 1000

/** Escape LIKE wildcards so a case-insensitive email match stays exact. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/**
 * True when the contact / email has an active (non-cancelled) Calendly
 * meeting that was booked on or after `since` (less a day of slack for
 * clock skew and "booked first, then filled in the form"), or that is
 * still upcoming.
 *
 * Throws on a query error — callers decide whether "unknown" means go or
 * no-go. (For a nudge it must mean no-go.)
 */
export async function hasActiveBookingSince(
  supabase: SupabaseClient,
  who: { contactId?: string | null; email?: string | null },
  since: string | null,
  now: Date = new Date(),
): Promise<boolean> {
  const email = who.email?.trim() || null
  if (!who.contactId && !email) return false

  const eventIds = new Set<string>()
  if (who.contactId) {
    const { data, error } = await supabase
      .from("calendly_invitees")
      .select("calendly_event_id")
      .eq("contact_id", who.contactId)
      .neq("status", "canceled")
      .not("calendly_event_id", "is", null)
      .limit(200)
    if (error) throw new Error(error.message)
    for (const row of data ?? []) eventIds.add(row.calendly_event_id as string)
  }
  if (email) {
    const { data, error } = await supabase
      .from("calendly_invitees")
      .select("calendly_event_id")
      .ilike("email", escapeLike(email))
      .neq("status", "canceled")
      .not("calendly_event_id", "is", null)
      .limit(200)
    if (error) throw new Error(error.message)
    for (const row of data ?? []) eventIds.add(row.calendly_event_id as string)
  }
  if (eventIds.size === 0) return false

  const { data: events, error } = await supabase
    .from("calendly_events")
    .select("id, start_time, calendly_created_at")
    .in("id", Array.from(eventIds))
    .eq("status", "active")
  if (error) throw new Error(error.message)

  const sinceMs = since ? new Date(since).getTime() : Number.NaN
  const bookedAfter = Number.isFinite(sinceMs) ? sinceMs - DAY_MS : null

  return (events ?? []).some((e) => {
    const starts = e.start_time ? new Date(e.start_time as string).getTime() : Number.NaN
    if (Number.isFinite(starts) && starts >= now.getTime()) return true
    if (bookedAfter === null) return false
    const booked = e.calendly_created_at
      ? new Date(e.calendly_created_at as string).getTime()
      : Number.NaN
    return Number.isFinite(booked) && booked >= bookedAfter
  })
}
