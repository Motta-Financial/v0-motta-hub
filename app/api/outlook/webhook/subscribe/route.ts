import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers"
import { ensureWebhookSubscription, type OutlookConnectionRow } from "@/lib/outlook-api"

/**
 * POST → (re)creates the Graph change-notification subscriptions for
 * the signed-in user's mailbox + calendar. Backs the "Subscribe" action
 * in the webhook-not-configured banner.
 */
export async function POST() {
  try {
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

    if (!connection) {
      return NextResponse.json({ error: "Outlook is not connected" }, { status: 404 })
    }

    const result = await ensureWebhookSubscription(connection as OutlookConnectionRow, supabase)

    if (result.subscriptionIds.length === 0) {
      return NextResponse.json(
        { error: result.error || "Failed to create webhook subscription" },
        { status: 502 },
      )
    }

    return NextResponse.json({ success: true, subscriptionCount: result.subscriptionIds.length })
  } catch (err) {
    console.error("[outlook] webhook subscribe error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
