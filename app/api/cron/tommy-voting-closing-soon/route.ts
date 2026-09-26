import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { buildTommyVotingClosingSoonHtml, sendCategoryEmail } from "@/lib/email"
import { isEasternHourAndWeekday, nowInEastern } from "@/lib/cron-eastern"
import { firmConfigSync } from "@/lib/firm-settings"
import { isHiddenFromTommyAwards } from "@/lib/tommy-awards/hidden-members"

/**
 * Vercel Cron endpoint that emails every active team member a "voting
 * closes in 15 minutes" nudge for the Tommy Awards.
 *
 * Target send time: Fridays at 11:45 AM Eastern — 15 minutes before the
 * 12:00 PM ballot close (see tommy-weekly-recap/route.ts and
 * tommy-recap-send/route.ts for the close + send pipeline).
 *
 * Vercel Cron is timezone-naive (UTC only), so this endpoint is scheduled
 * in vercel.json at BOTH possible UTC minute/hour pairs that map to
 * 11:45 AM Eastern:
 *   - `45 15 * * 5`  — Friday 15:45 UTC = 11:45 AM EDT (March-November)
 *   - `45 16 * * 5`  — Friday 16:45 UTC = 11:45 AM EST (November-March)
 * The cron minute field (45) already pins the exact minute, so the guard
 * below only needs to check the Eastern hour (11) and weekday (Fri) —
 * exactly one of the two scheduled invocations will pass on any given
 * Friday. The other no-ops with `skipped: true`.
 *
 * Not everyone is required to vote, but this makes sure nobody who
 * intended to misses the window without knowing it's about to close.
 *
 * Auth: validates the standard Vercel cron Authorization: Bearer ${CRON_SECRET} header.
 * Manual override: pass `?force=true` to bypass the Eastern-time guard
 * (auth still required in production).
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.CRON_SECRET && process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  // DST guard: only proceed when we're actually at 11:45 AM ET on a Friday.
  // The other UTC-twin invocation will hit this branch and exit cleanly.
  const url = new URL(request.url)
  const force = url.searchParams.get("force") === "true"
  if (!force && !isEasternHourAndWeekday(11, 5)) {
    const { hour, weekday } = nowInEastern()
    return NextResponse.json({
      success: true,
      skipped: true,
      reason: "Not 11:45 AM Eastern on a Friday — skipping (DST twin invocation).",
      eastern_hour: hour,
      eastern_weekday: weekday,
    })
  }

  try {
    const supabase = createAdminClient()
    const appUrl = firmConfigSync().hubUrl

    // Compute this week's Friday date label (used in the email copy).
    const today = new Date()
    const day = today.getDay()
    const diff = day <= 5 ? 5 - day : 5 - day + 7
    const friday = new Date(today)
    friday.setDate(today.getDate() + diff)
    const weekLabel = friday.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    })

    // Fetch all active team members; exclude members hidden from the
    // Tommy Awards experience to keep the recipient list clean.
    // Ganesh Vasan and Thameem JA vote together as "P24" — combined email.
    const COMBINED_VOTERS = ["Ganesh Vasan", "Thameem JA"]

    const { data: members, error } = await supabase
      .from("team_members")
      .select("id, full_name, email")
      .eq("is_active", true)

    if (error) throw error

    const gtMembers = (members || []).filter(
      (m) => m.email && COMBINED_VOTERS.includes(m.full_name),
    )
    const regularMembers = (members || []).filter(
      (m) => m.email && !isHiddenFromTommyAwards(m.full_name) && !COMBINED_VOTERS.includes(m.full_name),
    )

    const ballotUrl = `${appUrl}/tommy-awards`
    const results: boolean[] = []

    await Promise.all(
      regularMembers.map(async (m) => {
        const html = buildTommyVotingClosingSoonHtml({
          recipientName: m.full_name?.split(" ")[0] || "there",
          weekLabel,
          ballotUrl,
        })
        const r = await sendCategoryEmail({
          category: "tommy_reminder",
          teamMemberIds: [m.id],
          subject: `Tommy Awards — Voting Closes in 15 Minutes`,
          html,
        })
        results.push(r.sent > 0)
      }),
    )

    if (gtMembers.length > 0) {
      const html = buildTommyVotingClosingSoonHtml({
        recipientName: "P24",
        weekLabel,
        ballotUrl,
      })
      const r = await sendCategoryEmail({
        category: "tommy_reminder",
        teamMemberIds: gtMembers.map((m) => m.id),
        subject: `Tommy Awards — Voting Closes in 15 Minutes`,
        html,
      })
      results.push(r.sent > 0)
    }

    const sent = results.filter(Boolean).length
    const totalEligible = regularMembers.length + (gtMembers.length > 0 ? 1 : 0)
    const skipped = totalEligible - sent

    return NextResponse.json({
      success: true,
      total_eligible: totalEligible,
      sent,
      skipped_due_to_preferences: skipped,
      week_label: weekLabel,
    })
  } catch (error) {
    console.error("[cron/tommy-voting-closing-soon] Error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}
