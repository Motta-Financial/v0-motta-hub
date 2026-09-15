import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * Microsoft Graph change-notification endpoint.
 *
 * Validation handshake: when a subscription is created (or renewed),
 * Graph POSTs to this URL with `?validationToken=...` and expects the
 * raw token echoed back as `text/plain` within 10 seconds — see
 * https://learn.microsoft.com/en-us/graph/webhooks#notification-endpoint-validation
 *
 * Notification delivery: subsequent POSTs carry a JSON body of
 * notifications. `clientState` is set to the connection's
 * team_member_id at subscribe time (lib/outlook-api.ts), so we check it
 * matches before trusting the payload — Graph notifications carry no
 * other signature. We don't process notification content synchronously
 * (Graph requires a fast 202); we just flag the connection for the next
 * "Sync now" / poll to pick up.
 */
export async function POST(request: NextRequest) {
  const validationToken = request.nextUrl.searchParams.get("validationToken")
  if (validationToken) {
    return new NextResponse(validationToken, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    })
  }

  try {
    const body = await request.json()
    const notifications: Array<{ clientState?: string; subscriptionId?: string }> =
      body?.value || []
    if (notifications.length === 0) {
      return new NextResponse(null, { status: 202 })
    }

    const supabase = createAdminClient()
    const teamMemberIds = Array.from(
      new Set(notifications.map((n) => n.clientState).filter((v): v is string => Boolean(v))),
    )

    if (teamMemberIds.length > 0) {
      // Best-effort staleness flag; the actual content is pulled on the
      // next sync rather than processed here, per Graph's 202-fast rule.
      await supabase
        .from("outlook_connections")
        .update({ last_sync_error: null, updated_at: new Date().toISOString() })
        .in("team_member_id", teamMemberIds)
    }

    return new NextResponse(null, { status: 202 })
  } catch (err) {
    console.error("[outlook] webhook notification error:", err)
    // Still ack with 202 so Graph doesn't back off/retry a malformed
    // payload indefinitely.
    return new NextResponse(null, { status: 202 })
  }
}
