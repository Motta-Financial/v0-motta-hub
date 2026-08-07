/**
 * Discovery-call booking link for an intake prospect.
 *
 * The gap this closes: before now, the intake form ended with "a
 * teammate will follow up within one business day to schedule your
 * discovery call". That manual handoff is where the funnel leaked —
 * of 130 intakes with a resolved contact in the 18 months to
 * 2026-08, only 8 booked a meeting within a week. Meanwhile 58% of
 * actual Calendly bookings had no intake on file at all, because
 * booking and intake were two unconnected front doors.
 *
 * So: generate the booking link at ingest time, hand it to the
 * prospect immediately (booking step in the wizard + confirmation
 * email), and stamp it with enough tracking that the resulting
 * booking points back at the intake row that produced it.
 *
 * ── Routing ──────────────────────────────────────────────────────
 * The intake form asks "is there a specific team member you'd prefer
 * to meet with?". When that resolves to a real teammate who owns an
 * active Discovery event type, we send the prospect to THAT person's
 * calendar. Otherwise we fall back to the firm's team/round-robin
 * link (`firmConfig.discoveryBookingUrl`). Honoring the preference is
 * the whole point of asking the question.
 *
 * ── Attribution ──────────────────────────────────────────────────
 * Calendly's prefill/tracking query params survive into the
 * `invitee.created` webhook payload under `invitee.tracking`, which
 * `mapCalendlyInviteeFields` persists verbatim on `calendly_invitees`.
 * We put the intake row's UUID in `salesforce_uuid` — Calendly's
 * generic opaque-id passthrough — so the webhook can write
 * `calendly_event_id` straight back onto the intake row. That gives
 * exact attribution instead of the fuzzy contact_id join the funnel
 * numbers previously had to be reconstructed from.
 *
 * `name` / `email` prefill the Calendly booking form so the prospect
 * doesn't retype what they just told us. This also means the invitee
 * email matches the intake email, which keeps the existing
 * contact-matching path working as a second attribution signal.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { getFirmConfig } from "@/lib/firm-settings"

export interface BookingLinkInput {
  /** `jotform_intake_submissions.id` — the attribution key. */
  submissionId: string
  fullName?: string | null
  email?: string | null
  /** Resolved `team_members.id` for the requested teammate, if any. */
  preferredTeamMemberId?: string | null
}

export interface BookingLinkResult {
  url: string
  /** Which calendar the prospect was routed to. */
  routing: "preferred_team_member" | "firm_default"
  /** Display name of the host, when we routed to a specific person. */
  hostName: string | null
}

/**
 * Names that identify a first-meeting event type. Matched
 * case-insensitively as a substring so both "Discovery Meeting" and
 * "Discovery Meeting (First Meeting with Motta)" qualify — the Motta
 * account currently has both, per-person and team-level.
 */
const DISCOVERY_NAME_PATTERN = "%discovery%"

/**
 * Find the preferred teammate's own Discovery scheduling URL.
 *
 * `calendly_event_types` is keyed by `calendly_user_uri`, not by Hub
 * team member, so we hop through `calendly_connections` to translate.
 * A teammate with no active connection (never authorized, or token
 * lapsed) simply yields null and the caller falls back to the firm
 * link — that is the correct degradation, since a stale personal link
 * would send the prospect to a calendar nobody watches.
 */
async function findTeamMemberDiscoveryUrl(
  supabase: SupabaseClient,
  teamMemberId: string,
): Promise<{ url: string; hostName: string | null } | null> {
  const { data: connection, error: connErr } = await supabase
    .from("calendly_connections")
    .select("calendly_user_uri, calendly_user_name")
    .eq("team_member_id", teamMemberId)
    .eq("is_active", true)
    .maybeSingle()

  if (connErr) {
    console.log("[intake/booking-link] connection lookup failed:", connErr.message)
    return null
  }
  if (!connection?.calendly_user_uri) return null

  const { data: eventTypes, error: etErr } = await supabase
    .from("calendly_event_types")
    .select("name, slug, scheduling_url, active")
    .eq("calendly_user_uri", connection.calendly_user_uri)
    .eq("active", true)
    .ilike("name", DISCOVERY_NAME_PATTERN)
    .not("scheduling_url", "is", null)
    // Standard event types (those with a slug, e.g.
    // /amy-sparaco-mottafinancial/discovery-meeting-…) before slug-less
    // ones. A slug-less row is a Calendly `/d/…` link, which can be a
    // single-use or capped share link — handing that to an intake
    // prospect risks a dead URL by the time they click it.
    .order("slug", { ascending: true, nullsFirst: false })
    .limit(5)

  if (etErr) {
    console.log("[intake/booking-link] event type lookup failed:", etErr.message)
    return null
  }
  const match = (eventTypes ?? []).find((et) => et.slug && et.scheduling_url)
    ?? (eventTypes ?? [])[0]
  if (!match?.scheduling_url) return null

  return {
    url: match.scheduling_url,
    hostName: connection.calendly_user_name ?? null,
  }
}

/**
 * Append Calendly prefill + tracking params to a scheduling URL.
 *
 * Uses URL/searchParams rather than string concatenation so a
 * scheduling_url that already carries a query string (single-use links
 * do) keeps working, and so values are encoded correctly.
 */
function decorate(baseUrl: string, input: BookingLinkInput): string {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    // A malformed configured URL shouldn't take the whole intake down —
    // hand back what we were given and let the prospect see a broken
    // link rather than a 500 on submit.
    console.log("[intake/booking-link] malformed base URL:", baseUrl)
    return baseUrl
  }

  const name = input.fullName?.trim()
  const email = input.email?.trim()
  if (name) url.searchParams.set("name", name)
  if (email) url.searchParams.set("email", email)

  // Attribution. `salesforce_uuid` is Calendly's opaque passthrough
  // field — despite the name it has nothing to do with Salesforce and
  // is the documented way to carry your own record id through a
  // booking. It round-trips into invitee.tracking on the webhook.
  url.searchParams.set("salesforce_uuid", input.submissionId)
  url.searchParams.set("utm_source", "hub_intake")
  url.searchParams.set("utm_medium", "intake_form")
  url.searchParams.set("utm_campaign", "discovery_call")

  // Collapse Calendly's own "back to event list" chrome — the prospect
  // came here to book one specific thing.
  url.searchParams.set("hide_event_type_details", "0")

  return url.toString()
}

/**
 * Resolve the discovery-call URL to offer this prospect.
 *
 * Never throws: a failure anywhere degrades to the firm default link,
 * because shipping the prospect a working generic link always beats
 * failing the intake submit over a routing lookup.
 */
export async function resolveDiscoveryBookingUrl(
  supabase: SupabaseClient,
  input: BookingLinkInput,
): Promise<BookingLinkResult> {
  const config = await getFirmConfig().catch(() => null)
  const fallbackUrl =
    config?.discoveryBookingUrl ||
    "https://calendly.com/motta-financial/discovery-meeting"

  if (input.preferredTeamMemberId) {
    try {
      const preferred = await findTeamMemberDiscoveryUrl(
        supabase,
        input.preferredTeamMemberId,
      )
      if (preferred) {
        return {
          url: decorate(preferred.url, input),
          routing: "preferred_team_member",
          hostName: preferred.hostName,
        }
      }
    } catch (err) {
      console.log(
        "[intake/booking-link] preferred routing failed, using firm default:",
        (err as Error).message,
      )
    }
  }

  return {
    url: decorate(fallbackUrl, input),
    routing: "firm_default",
    hostName: null,
  }
}
