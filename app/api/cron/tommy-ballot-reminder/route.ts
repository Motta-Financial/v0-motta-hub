import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { buildTommyReminderHtml, sendCategoryEmail } from "@/lib/email"

/**
 * Vercel Cron endpoint that emails every active team member a Tommy Awards
 * ballot reminder. Configured in vercel.json to run Friday morning.
 *
 * Auth: validates the standard Vercel cron Authorization: Bearer ${CRON_SECRET} header.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.CRON_SECRET && process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
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
    const HIDDEN_MEMBERS = ["Grace Cha", "Beth Nietupski"]
    const { data: members, error } = await supabase
      .from("team_members")
      .select("id, full_name, email")
      .eq("is_active", true)

    if (error) throw error

    const eligible = (members || []).filter(
      (m) => m.email && !HIDDEN_MEMBERS.includes(m.full_name),
    )

    // Send one personalized email per recipient so the greeting is correct.
    const ballotUrl = `${appUrl}/tommy-awards`
    const results = await Promise.all(
      eligible.map(async (m) => {
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
        return r.sent > 0
      }),
    )

    const sent = results.filter(Boolean).length
    const skipped = eligible.length - sent

    return NextResponse.json({
      success: true,
      total_eligible: eligible.length,
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
