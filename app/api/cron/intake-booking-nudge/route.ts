/**
 * Daily sweep: nudge intake prospects who never booked a discovery call.
 *
 * Runs once a day rather than hourly — the nudge is due 48h after the
 * confirmation email, so a day's granularity is plenty and it keeps the
 * blast radius of a bug to one batch. All the eligibility rules (one
 * nudge ever, skip if booked, skip if a human already picked the lead
 * up, hard age cap) live in `sweepBookingNudges`.
 *
 * Auth: `CRON_SECRET` bearer, matching the other cron routes. Non-prod
 * without a secret configured is allowed through so it can be exercised
 * locally.
 */

import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { sweepBookingNudges } from "@/lib/intake/booking-nudge"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.CRON_SECRET && process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  try {
    const supabase = createAdminClient()
    const result = await sweepBookingNudges(supabase)
    console.log(
      `[cron/intake-booking-nudge] scanned=${result.scanned} sent=${result.sent} failed=${result.failed}`,
    )
    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    console.error("[cron/intake-booking-nudge] failed:", err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    )
  }
}
