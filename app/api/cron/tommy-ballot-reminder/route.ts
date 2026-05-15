import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { buildTommyReminderHtml, sendCategoryEmail } from "@/lib/email"
import { isEasternHourAndWeekday, nowInEastern } from "@/lib/cron-eastern"

/**
 * Vercel Cron endpoint that emails every active team member a Tommy Awards
 * ballot reminder.
 *
 * Target send time: Thursdays at 3:00 PM Eastern, year-round.
 *
 * Vercel Cron is timezone-naive (UTC only), so this endpoint is scheduled
 * in vercel.json at BOTH possible UTC hours that map to 3:00 PM Eastern:
 *   - `0 19 * * 4`  — Thursday 19:00 UTC = 3:00 PM EDT (March-November)
 *   - `0 20 * * 4`  — Thursday 20:00 UTC = 3:00 PM EST (November-March)
 * Exactly one of those invocations will satisfy the DST-aware
 * `isEasternHourAndWeekday(15, 4)` guard below on any given Thursday and
 * actually send. The other invocation no-ops with `skipped: true`.
 *
 * Voting stays open through Friday morning; the firm-wide recap goes
 * out Friday at noon Eastern (see tommy-weekly-recap/route.ts).
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

  // DST guard: only proceed when we're actually at 3 PM ET on a Thursday.
  // The other UTC-twin invocation will hit this branch and exit cleanly.
  const url = new URL(request.url)
  const force = url.searchParams.get("force") === "true"
  if (!force && !isEasternHourAndWeekday(15, 4)) {
    const { hour, weekday } = nowInEastern()
    return NextResponse.json({
      success: true,
      skipped: true,
      reason: "Not 3:00 PM Eastern on a Thursday — skipping (DST twin invocation).",
      eastern_hour: hour,
      eastern_weekday: weekday,
    })
  }

  try {
    const supabase = createAdminClient()
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://motta.cpa"

    // Compute this week's Friday date label (used in the reminder copy)
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

    // Fetch all active team members; we exclude members who are hidden from
    // the Tommy Awards experience to keep the email list clean.
    // Ganesh Vasan and Thameem JA vote together as "P24" — they get a combined email.
    const HIDDEN_MEMBERS = ["Grace Cha", "Beth Nietupski"]
    const COMBINED_VOTERS = ["Ganesh Vasan", "Thameem JA"]
    
    const { data: members, error } = await supabase
      .from("team_members")
      .select("id, full_name, email")
      .eq("is_active", true)

    if (error) throw error

    // Separate out the combined voters (P24) and the regular voters
    const gtMembers = (members || []).filter(
      (m) => m.email && COMBINED_VOTERS.includes(m.full_name),
    )
    const regularMembers = (members || []).filter(
      (m) => m.email && !HIDDEN_MEMBERS.includes(m.full_name) && !COMBINED_VOTERS.includes(m.full_name),
    )

    // Send one personalized email per recipient so the greeting is correct.
    const ballotUrl = `${appUrl}/tommy-awards`
    const results: boolean[] = []
    
    // Send to regular voters
    await Promise.all(
      regularMembers.map(async (m) => {
        const html = buildTommyReminderHtml({
          recipientName: m.full_name?.split(" ")[0] || "there",
          weekLabel,
          ballotUrl,
        })
        const r = await sendCategoryEmail({
          category: "tommy_reminder",
          teamMemberIds: [m.id],
          subject: `Tommy Awards — Vote for the Week of ${weekLabel}`,
          html,
        })
        results.push(r.sent > 0)
      }),
    )
    
    // Send a single combined email to P24 (both Ganesh and Thameem)
    if (gtMembers.length > 0) {
      const html = buildTommyReminderHtml({
        recipientName: "P24",
        weekLabel,
        ballotUrl,
      })
      const r = await sendCategoryEmail({
        category: "tommy_reminder",
        teamMemberIds: gtMembers.map((m) => m.id),
        subject: `Tommy Awards — Vote for the Week of ${weekLabel}`,
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
    console.error("[cron/tommy-ballot-reminder] Error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}
