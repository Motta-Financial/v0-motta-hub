import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { buildMeetingDigestHtml, sendCategoryEmail } from "@/lib/email"

/**
 * Vercel Cron endpoint that emails each active team member their personal
 * meeting digest combining Calendly + Zoom data. Configured in vercel.json.
 *
 * The digest:
 *   - Upcoming: events scheduled in the next 7 days where the team member
 *     is the host/owner (Calendly events keyed by team_member_id, Zoom meetings
 *     by team_member_id).
 *   - Recent: events in the past 7 days for the same scope.
 *
 * Recipients who have opted out of the "meeting_summary" category are skipped
 * automatically by sendCategoryEmail().
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

    const now = new Date()
    const upcomingWindowEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    const recentWindowStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    const rangeLabel = `${recentWindowStart.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    })} - ${upcomingWindowEnd.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`

    const { data: members, error: membersErr } = await supabase
      .from("team_members")
      .select("id, full_name, email")
      .eq("is_active", true)
    if (membersErr) throw membersErr

    const eligible = (members || []).filter((m) => m.email)
    if (eligible.length === 0) {
      return NextResponse.json({ success: true, sent: 0, message: "No eligible recipients" })
    }

    // Fetch all relevant events in two queries to minimize round trips.
    const [{ data: calendlyEvents }, { data: zoomMeetings }] = await Promise.all([
      supabase
        .from("calendly_events")
        .select("team_member_id, name, start_time, end_time, status, calendly_uri, location")
        .gte("start_time", recentWindowStart.toISOString())
        .lte("start_time", upcomingWindowEnd.toISOString())
        .order("start_time", { ascending: true }),
      supabase
        .from("zoom_meetings")
        .select("team_member_id, topic, start_time, duration, join_url, status")
        .gte("start_time", recentWindowStart.toISOString())
        .lte("start_time", upcomingWindowEnd.toISOString())
        .order("start_time", { ascending: true }),
    ])

    type Row = { when: string; title: string; with?: string; source: string; url?: string }

    const formatWhen = (iso: string) => {
      const d = new Date(iso)
      return d.toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    }

    let totalSent = 0
    let totalSkipped = 0

    for (const member of eligible) {
      const upcoming: Row[] = []
      const recent: Row[] = []

      for (const ev of calendlyEvents || []) {
        if (ev.team_member_id !== member.id) continue
        const start = new Date(ev.start_time)
        const row: Row = {
          when: formatWhen(ev.start_time),
          title: ev.name || "Calendly Event",
          source: "Calendly",
          url: ev.calendly_uri || undefined,
        }
        if (start > now) upcoming.push(row)
        else recent.push(row)
      }

      for (const m of zoomMeetings || []) {
        if (m.team_member_id !== member.id) continue
        const start = new Date(m.start_time)
        const row: Row = {
          when: formatWhen(m.start_time),
          title: m.topic || "Zoom Meeting",
          source: "Zoom",
          url: m.join_url || undefined,
        }
        if (start > now) upcoming.push(row)
        else recent.push(row)
      }

      // Skip emailing members with absolutely no meetings either way - no value.
      if (upcoming.length === 0 && recent.length === 0) {
        totalSkipped++
        continue
      }

      // Cap each section at 15 rows to keep emails readable.
      upcoming.sort((a, b) => a.when.localeCompare(b.when))
      recent.sort((a, b) => b.when.localeCompare(a.when))

      const html = buildMeetingDigestHtml({
        recipientName: member.full_name?.split(" ")[0] || "there",
        rangeLabel,
        upcoming: upcoming.slice(0, 15),
        recent: recent.slice(0, 15),
      })

      const result = await sendCategoryEmail({
        category: "meeting_summary",
        teamMemberIds: [member.id],
        subject: `Meeting Digest - ${rangeLabel}`,
        html,
      })

      totalSent += result.sent
      totalSkipped += result.skipped
    }

    return NextResponse.json({
      success: true,
      total_members: eligible.length,
      sent: totalSent,
      skipped: totalSkipped,
      range: rangeLabel,
    })
  } catch (error) {
    console.error("[cron/meeting-summary] Error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}
