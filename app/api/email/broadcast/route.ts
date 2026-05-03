import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { buildBroadcastHtml, sendCategoryEmail } from "@/lib/email"

/**
 * POST /api/email/broadcast
 * Sends a custom announcement email to selected (or all) team members.
 *
 * Body:
 *   {
 *     subject: string,
 *     bodyHtml: string,           // pre-rendered HTML (e.g. from a textarea -> simple <br> conversion)
 *     fromName: string,           // sender display name shown in the email body
 *     recipientIds?: string[],    // optional - omit to send to all active team members
 *     force?: boolean             // optional - if true, ignore broadcast opt-out preferences (use sparingly)
 *   }
 *
 * Recipients who have opted out of the "broadcast" category are skipped unless
 * force=true. Always respects is_active=true.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { subject, bodyHtml, fromName, recipientIds, force = false } = body

    if (!subject || !bodyHtml || !fromName) {
      return NextResponse.json(
        { error: "subject, bodyHtml, and fromName are required" },
        { status: 400 },
      )
    }

    const supabase = createAdminClient()

    // Resolve recipient pool
    let memberQuery = supabase.from("team_members").select("id, full_name, email, is_active")
    if (Array.isArray(recipientIds) && recipientIds.length > 0) {
      memberQuery = memberQuery.in("id", recipientIds)
    }
    const { data: members, error: membersErr } = await memberQuery
    if (membersErr) throw membersErr

    const eligible = (members || []).filter((m) => m.is_active && m.email)
    if (eligible.length === 0) {
      return NextResponse.json({ success: true, attempted: 0, sent: 0, skipped: 0 })
    }

    const html = buildBroadcastHtml({ subject, bodyHtml, fromName })

    let sent = 0
    let skipped = 0

    if (force) {
      // Bypass per-user preferences entirely
      const { sendEmail } = await import("@/lib/email")
      const results = await Promise.all(
        eligible.map((m) =>
          sendEmail({ to: m.email, subject, html }).then((r) => r.success),
        ),
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

    return NextResponse.json({
      success: true,
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
