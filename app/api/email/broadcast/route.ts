import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { buildAnnouncementHtml, sendCategoryEmail } from "@/lib/email"

/**
 * POST /api/email/broadcast
 *
 * Publishes a firm-wide announcement. A single submission does two things:
 *   1. Persists a row in `public.firm_announcements`, which the Triage feed
 *      reads so the announcement lands in EVERY team member's triage as a
 *      `broadcast` item (dismissible per-user via triage_dismissals).
 *   2. Emails the announcement to all active team members, authored by
 *      ALFRED Ai, with the subject line "BREAKING NEWS: <Topic>".
 *
 * Body:
 *   {
 *     topic: string,                // headline (-> subject "BREAKING NEWS: <topic>")
 *     announcement: string,         // body
 *     actionItems?: string,         // optional follow-ups
 *     createdById?: string,         // team_members.id of the author (optional)
 *     createdByName?: string,       // author display name (optional)
 *     force?: boolean               // bypass per-user broadcast opt-outs
 *   }
 *
 * Any team member may post a firm announcement.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
      topic,
      announcement,
      actionItems,
      createdById,
      createdByName,
      force = false,
    } = body || {}

    if (!topic?.trim() || !announcement?.trim()) {
      return NextResponse.json(
        { error: "topic and announcement are required" },
        { status: 400 },
      )
    }

    const supabase = createAdminClient()

    // Resolve recipient pool — all active team members with an email.
    const { data: members, error: membersErr } = await supabase
      .from("team_members")
      .select("id, full_name, email, is_active")
    if (membersErr) throw membersErr

    const eligible = (members || []).filter((m) => m.is_active && m.email)

    // 1. Persist the announcement so it appears in everyone's Triage feed.
    const { data: inserted, error: insertErr } = await supabase
      .from("firm_announcements")
      .insert({
        topic: topic.trim(),
        announcement: announcement.trim(),
        action_items: actionItems?.trim() || null,
        created_by_id: createdById || null,
        created_by_name: createdByName || null,
        email_attempted_count: eligible.length,
      })
      .select("id")
      .single()
    if (insertErr) throw insertErr

    // 2. Email the announcement (from ALFRED) to the team.
    const subject = `BREAKING NEWS: ${topic.trim()}`
    const html = buildAnnouncementHtml({
      topic: topic.trim(),
      announcement: announcement.trim(),
      actionItems: actionItems?.trim() || null,
      fromName: createdByName || null,
    })

    let sent = 0
    let skipped = 0

    if (eligible.length > 0) {
      if (force) {
        // Bypass per-user preferences entirely.
        const { sendEmail } = await import("@/lib/email")
        const results = await Promise.all(
          eligible.map((m) => sendEmail({ to: m.email!, subject, html }).then((r) => r.success)),
        )
        sent = results.filter(Boolean).length
        skipped = eligible.length - sent
      } else {
        const result = await sendCategoryEmail({
          category: "broadcast",
          teamMemberIds: eligible.map((m) => m.id),
          subject,
          html,
        })
        sent = result.sent
        skipped = result.skipped
      }
    }

    // Record the send outcome on the announcement row (best-effort).
    await supabase
      .from("firm_announcements")
      .update({ email_sent_count: sent, email_skipped_count: skipped })
      .eq("id", inserted.id)

    return NextResponse.json({
      success: true,
      announcementId: inserted.id,
      attempted: eligible.length,
      sent,
      skipped,
    })
  } catch (error) {
    console.error("[email/broadcast] Error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}
