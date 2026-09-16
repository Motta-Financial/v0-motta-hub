/**
 * GET /api/outlook/messages?skip=&limit=
 *
 * A page of the signed-in user's inbox, newest first, for the Recent
 * Emails list on /settings/outlook.
 *
 * Separate from /api/outlook/threads on purpose: that one groups by
 * conversation for Triage, where the unit of work is "this exchange with
 * this client". Here the unit is the message, because this list is a
 * mailbox view — the same distinction Outlook draws between its
 * conversation and message layouts.
 *
 * Read-only. Unlike POST /api/outlook/sync it does not touch
 * last_synced_at or the sync counters, so scrolling the list never looks
 * like a sync that happened.
 */
import { NextResponse, type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers"
import {
  fetchRecentMessages,
  GraphApiError,
  type OutlookConnectionRow,
} from "@/lib/outlook-api"

const PAGE_SIZE = 25
const MAX_PAGE_SIZE = 100

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await getAuthenticatedUser(supabase)
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

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

    if (!connection) return NextResponse.json({ status: "not_connected", emails: [], nextSkip: null })
    if (connection.is_active === false) {
      return NextResponse.json({ status: "needs_reconnect", emails: [], nextSkip: null })
    }

    const skipParam = Number(request.nextUrl.searchParams.get("skip") ?? "0")
    const skip = Number.isFinite(skipParam) && skipParam > 0 ? Math.floor(skipParam) : 0

    const limitParam = Number(request.nextUrl.searchParams.get("limit") ?? PAGE_SIZE)
    const limit =
      Number.isFinite(limitParam) && limitParam > 0
        ? Math.min(Math.floor(limitParam), MAX_PAGE_SIZE)
        : PAGE_SIZE

    const messages = await fetchRecentMessages(
      connection as OutlookConnectionRow,
      supabase,
      limit,
      skip,
    )

    // A short page means the mailbox is exhausted. A full one doesn't prove
    // more exist — the next request just comes back empty, which ends the
    // list one fetch later rather than hiding mail.
    const nextSkip = messages.length < limit ? null : skip + messages.length

    return NextResponse.json({
      status: "connected",
      nextSkip,
      emails: messages.map((m) => ({
        id: m.id,
        subject: m.subject || "(no subject)",
        from: m.from?.emailAddress?.name || m.from?.emailAddress?.address || "Unknown sender",
        receivedAt: m.receivedDateTime,
        preview: m.bodyPreview || "",
      })),
    })
  } catch (err) {
    if (err instanceof GraphApiError && (err.status === 401 || err.status === 403)) {
      return NextResponse.json({ status: "needs_reconnect", emails: [], nextSkip: null })
    }
    console.error("[outlook] messages list error:", err)
    const message = err instanceof Error ? err.message : "Internal server error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
