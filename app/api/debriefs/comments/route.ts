import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import {
  buildNotificationEmailHtml,
  resolveRecipientsForCategory,
  sendEmail,
} from "@/lib/email"

function isTableNotFoundError(error: any): boolean {
  if (!error) return false

  // Check error code
  if (error.code === "PGRST205" || error.code === "42P01") return true

  // Check message
  const message = error.message?.toLowerCase() || ""
  if (
    message.includes("could not find") ||
    message.includes("does not exist") ||
    message.includes("debrief_comments")
  ) {
    return true
  }

  // Check hint
  const hint = error.hint?.toLowerCase() || ""
  if (hint.includes("perhaps you meant")) return true

  return false
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const debriefIds = searchParams.get("debriefIds")?.split(",").filter(Boolean)

    if (!debriefIds?.length) {
      return NextResponse.json({ comments: [], tableExists: true })
    }

    const { data, error } = await supabase
      .from("debrief_comments")
      .select("*")
      .in("debrief_id", debriefIds)
      .order("created_at", { ascending: true })

    if (error) {
      if (isTableNotFoundError(error)) {
        return NextResponse.json({ comments: [], tableExists: false })
      }
      // For any other error, still return empty comments gracefully
      console.error("Error fetching debrief comments:", error)
      return NextResponse.json({ comments: [], error: error.message })
    }

    return NextResponse.json({ comments: data || [], tableExists: true })
  } catch (error: any) {
    if (isTableNotFoundError(error)) {
      return NextResponse.json({ comments: [], tableExists: false })
    }
    console.error("Error fetching debrief comments:", error)
    // Return empty comments instead of error to prevent UI from breaking
    return NextResponse.json({ comments: [], error: "Failed to fetch comments" })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()
    const { debrief_id, author_id, author_name, content } = body

    if (!debrief_id || !author_id || !content) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const { data, error } = await supabase
      .from("debrief_comments")
      .insert({
        debrief_id,
        author_id,
        author_name,
        content,
      })
      .select()
      .single()

    if (error) {
      if (isTableNotFoundError(error)) {
        return NextResponse.json(
          {
            error: "The debrief_comments table does not exist. Please run the migration script.",
          },
          { status: 404 },
        )
      }
      throw error
    }

    // Fire-and-forget participant notifications for the new comment.
    // Failures don't break the API response — the comment is already saved.
    notifyDebriefParticipants(supabase, {
      debriefId: debrief_id,
      newComment: data,
      authorId: author_id,
      authorName: author_name,
      content,
    }).catch((err) => console.error("[debrief-comments] notify error:", err))

    return NextResponse.json(data)
  } catch (error: any) {
    if (isTableNotFoundError(error)) {
      return NextResponse.json(
        {
          error: "The debrief_comments table does not exist. Please run the migration script.",
        },
        { status: 404 },
      )
    }
    console.error("Error creating debrief comment:", error)
    return NextResponse.json({ error: "Failed to create comment" }, { status: 500 })
  }
}

/**
 * After a new comment lands, in-app notify and email the debrief author plus any
 * prior commenters (excluding the person who just commented). Uses the "debrief"
 * email-preference category so users can opt out.
 */
async function notifyDebriefParticipants(
  supabase: ReturnType<typeof createAdminClient>,
  params: {
    debriefId: string
    newComment: any
    authorId: string
    authorName: string
    content: string
  },
) {
  const { debriefId, authorId, authorName, content } = params

  // Resolve the debrief itself (for context + the original creator)
  const { data: debrief } = await supabase
    .from("debriefs")
    .select("id, created_by_id, organization_name, contact_id, debrief_date")
    .eq("id", debriefId)
    .single()
  if (!debrief) return

  // All prior commenters
  const { data: priorComments } = await supabase
    .from("debrief_comments")
    .select("author_id")
    .eq("debrief_id", debriefId)

  // Build a deduped recipient set: original author + everyone who previously
  // commented, MINUS the person who just commented.
  const recipientIds = new Set<string>()
  if (debrief.created_by_id) recipientIds.add(debrief.created_by_id)
  for (const c of priorComments || []) {
    if (c.author_id) recipientIds.add(c.author_id)
  }
  recipientIds.delete(authorId)
  if (recipientIds.size === 0) return

  // Resolve client name for nicer copy
  let clientName = debrief.organization_name || "a client"
  if (debrief.contact_id) {
    const { data: contact } = await supabase
      .from("contacts")
      .select("full_name")
      .eq("id", debrief.contact_id)
      .single()
    if (contact?.full_name) clientName = contact.full_name
  }

  const idsArr = Array.from(recipientIds)
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || "https://mottahub-motta.vercel.app"
  const debriefUrl = `${siteUrl}/debriefs?id=${debriefId}`
  const preview = content.length > 220 ? content.slice(0, 220) + "…" : content

  // 1. In-app notifications (always created, regardless of email opt-out)
  const inAppRows = idsArr.map((teamMemberId) => ({
    team_member_id: teamMemberId,
    notification_type: "debrief",
    entity_type: "debrief",
    entity_id: debriefId,
    title: `New comment on debrief — ${clientName}`,
    message: `${authorName} commented: "${preview}"`,
    action_url: `/?tab=debriefs&id=${debriefId}`,
    is_read: false,
  }))
  await supabase.from("notifications").insert(inAppRows)

  // 2. Email — preference-aware
  const optedIn = await resolveRecipientsForCategory(idsArr, "debrief")
  if (optedIn.length === 0) return

  await Promise.all(
    optedIn.map(async (r) => {
      const html = buildNotificationEmailHtml({
        recipientName: r.full_name?.split(" ")[0] || "there",
        title: `New comment on debrief — ${clientName}`,
        message: `${authorName} commented:\n\n"${content}"`,
        actionUrl: debriefUrl,
        actionLabel: "View Debrief & Reply",
      })
      const res = await sendEmail({
        to: r.email,
        subject: `${authorName} commented on the ${clientName} debrief`,
        html,
      })
      if (!res.success) {
        console.warn(`[debrief-comments] email to ${r.email} failed:`, res.error)
      }
    }),
  )
}
