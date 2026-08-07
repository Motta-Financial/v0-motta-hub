/**
 * GET /api/public/booking-hosts?submission_id=&name=&email=
 *
 * The people a prospect can book a discovery call with, each with a
 * prefilled, attribution-stamped scheduling URL, plus the firm
 * round-robin as the "no preference" option.
 *
 * Exists so the marketing site's confirmation screen can ask **who**
 * before showing a calendar. Previously the Hub returned a single
 * `booking_url` and the site dropped the prospect straight onto one
 * person's Calendly — which also meant they saw that person's ENTIRE
 * event-type list (Coffee Chat, Client Check-In, Kickoff…) rather than
 * just the discovery call, because a user-level Calendly URL renders the
 * whole menu. Every URL here is event-type specific, so the embed opens
 * on the discovery call and nothing else.
 *
 * `/api/public/intake` already returns the same list inline on submit;
 * this endpoint is for surfaces that need it separately (a standalone
 * "book a call" page, or a re-render after the submit response is gone).
 *
 * PUBLIC, same posture as the other `/api/public/*` routes: CORS-gated
 * to the firm's own origins. It exposes only what a prospect would see
 * on the public Calendly page anyway — names, roles, scheduling URLs.
 * No emails, no availability, no internal identifiers beyond the
 * team_member id the picker needs to echo back.
 */

import { NextRequest } from "next/server"
import { withPublicCors, jsonWithCors, optionsForCors } from "@/lib/cors"
import { createAdminClient } from "@/lib/supabase/server"
import { listDiscoveryBookingHosts } from "@/lib/intake/booking-link"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return optionsForCors(req)
}

export const GET = withPublicCors(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams
  // Optional: when the caller has an intake row, every URL carries it so
  // the resulting booking attributes back to that submission. Without
  // one the links still work, they're just unattributed.
  const submissionId = sp.get("submission_id") ?? ""
  const fullName = sp.get("name")
  const email = sp.get("email")

  try {
    const supabase = createAdminClient()
    const { hosts, defaultUrl } = await listDiscoveryBookingHosts(supabase, {
      submissionId,
      fullName,
      email,
    })

    return jsonWithCors(req, {
      ok: true,
      hosts,
      default_url: defaultUrl,
    })
  } catch (err) {
    console.error("[api/public/booking-hosts] failed:", err)
    // Degrade to an empty list rather than an error: the caller can still
    // render its "no preference" CTA from the intake response's
    // booking_url, which is the important path.
    return jsonWithCors(req, { ok: false, hosts: [], default_url: null }, 200)
  }
})
