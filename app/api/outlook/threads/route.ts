import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers"
import { fetchInboxThreads, GraphApiError, type OutlookConnectionRow } from "@/lib/outlook-api"
import { enrichThreads } from "@/lib/outlook-thread-assignment"

/**
 * GET → the signed-in user's real Outlook threads for the Triage feed's
 * "Emails" tab (components/triage-feed.tsx). Mirrors the connection
 * lookup in /api/outlook/sync, but for a person's own mailbox rather
 * than firm-wide data — no team_member_id is accepted as input, it's
 * always derived from the session.
 */
export async function GET() {
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
      return NextResponse.json({ status: "not_connected", threads: [] })
    }
    if (connection.is_active === false) {
      return NextResponse.json({ status: "needs_reconnect", threads: [] })
    }

    const threads = await fetchInboxThreads(connection as OutlookConnectionRow, supabase)

    // Graph knows addresses, not clients. Attach who each thread is with,
    // that client's open work items, and any existing filing -- three
    // queries for the whole page, not three per thread.
    const enrichment = await enrichThreads(supabase, threads)

    return NextResponse.json({
      status: "connected",
      threads: threads.map((t) => {
        const extra = enrichment.get(t.id)
        return {
          ...t,
          // null client means the address matched no contact or org: a
          // vendor, a colleague, a newsletter. The UI shows no project
          // control for those rather than an empty dropdown.
          client: extra?.client ?? null,
          availableProjects: extra?.availableProjects ?? [],
          assignment: extra?.assignment ?? null,
        }
      }),
    })
  } catch (err) {
    if (err instanceof GraphApiError && (err.status === 401 || err.status === 403)) {
      return NextResponse.json({ status: "needs_reconnect", threads: [] })
    }
    console.error("[outlook] threads list error:", err)
    const message = err instanceof Error ? err.message : "Internal server error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
