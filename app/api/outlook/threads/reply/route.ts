import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers"
import { GraphApiError, replyToMessage, type OutlookConnectionRow } from "@/lib/outlook-api"

/**
 * POST /api/outlook/threads/reply { messageId, text } → sends `text` as
 * a reply to `messageId` (the latest message in the conversation, from
 * the Triage feed's Reply box) via Microsoft Graph. Graph replies to the
 * original sender + recipients automatically, so the Hub never needs to
 * know or store the other party's address itself.
 *
 * Requires the Mail.Send scope — connections created before it was
 * added will fail with GraphApiError(403) and need to reconnect.
 */
export async function POST(request: Request) {
  try {
    const { messageId, text } = (await request.json()) as { messageId?: string; text?: string }
    if (!messageId || !text?.trim()) {
      return NextResponse.json({ error: "messageId and text are required" }, { status: 400 })
    }

    const supabase = await createClient()

    const {
      data: { user },
    } = await getAuthenticatedUser(supabase)
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const { data: teamMember } = await supabase
      .from("team_members")
      .select("id")
      .eq("auth_user_id", user.id)
      .single()

    if (!teamMember) {
      return NextResponse.json({ error: "Team member not found" }, { status: 404 })
    }

    const { data: connection } = await supabase
      .from("outlook_connections")
      .select("*")
      .eq("team_member_id", teamMember.id)
      .maybeSingle()

    if (!connection || connection.is_active === false) {
      return NextResponse.json({ error: "Outlook is not connected" }, { status: 409 })
    }

    await replyToMessage(connection as OutlookConnectionRow, supabase, messageId, text.trim())
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof GraphApiError && (err.status === 401 || err.status === 403)) {
      return NextResponse.json(
        {
          error:
            "Sending needs a permission this connection doesn't have yet. Reconnect Outlook from Settings to grant it, then try again.",
        },
        { status: 409 },
      )
    }
    console.error("[outlook] reply error:", err)
    const message = err instanceof Error ? err.message : "Internal server error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
