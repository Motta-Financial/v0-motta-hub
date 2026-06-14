import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const dynamic = "force-dynamic"

/**
 * GET /api/tax/proconnect-status
 *
 * Returns the current ProConnect connection state used by the
 * /tax/settings Connection Status card. It is intentionally
 * lightweight — no Intuit API calls, just a snapshot of:
 *
 *  - whether we have a stored access/refresh token
 *  - when it was last refreshed and when it expires
 *  - the realm id (so the user knows which firm is connected)
 *  - last successful client/engagement sync timestamps
 *  - last 5 webhook events (status + entity)
 */
export async function GET() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // 1. OAuth singleton
  const { data: token } = await supabase
    .from("proconnect_oauth_tokens")
    .select(
      "realm_id, expires_at, updated_at, created_at, scope, token_type, connected_by_team_member_id, last_refresh_error"
    )
    .eq("is_singleton", true)
    .maybeSingle()

  const connected = !!token
  const now = Date.now()
  const expiresAt = token?.expires_at ? new Date(token.expires_at).getTime() : null
  const accessExpired = expiresAt !== null && expiresAt <= now
  // A non-null refresh error means the stored refresh token stopped working,
  // so an admin must re-consent. Surfaced as "Reconnect required" in the UI.
  const reconnectRequired = !!token?.last_refresh_error

  // Resolve who connected the firm (admin name shown on the settings card).
  let connectedBy: { name: string | null } | null = null
  if (token?.connected_by_team_member_id) {
    const { data: tm } = await supabase
      .from("team_members")
      .select("full_name")
      .eq("id", token.connected_by_team_member_id)
      .maybeSingle()
    connectedBy = { name: tm?.full_name ?? null }
  }

  // 2. Last sync watermarks
  const [{ data: clientWatermark }, { data: engagementWatermark }] = await Promise.all([
    supabase
      .from("proconnect_clients")
      .select("synced_at")
      .order("synced_at", { ascending: false })
      .limit(1),
    supabase
      .from("proconnect_engagements")
      .select("synced_at")
      .order("synced_at", { ascending: false })
      .limit(1),
  ])

  // 3. Recent webhook events (latest 5)
  const { data: recentWebhooks } = await supabase
    .from("proconnect_webhook_events")
    .select("id, received_at, event_type, entity_id, operation, processing_status, processing_error")
    .order("received_at", { ascending: false })
    .limit(5)

  // 4. Counts
  const [{ count: clientCount }, { count: engagementCount }] = await Promise.all([
    supabase.from("proconnect_clients").select("id", { count: "exact", head: true }),
    supabase.from("proconnect_engagements").select("id", { count: "exact", head: true }),
  ])

  return NextResponse.json({
    connected,
    realmId: token?.realm_id ?? null,
    scope: token?.scope ?? null,
    tokenType: token?.token_type ?? null,
    accessExpiresAt: token?.expires_at ?? null,
    accessExpired,
    lastTokenRefresh: token?.updated_at ?? null,
    connectedSince: token?.created_at ?? null,
    connectedBy,
    reconnectRequired,
    lastRefreshError: token?.last_refresh_error ?? null,
    lastClientSync: clientWatermark?.[0]?.synced_at ?? null,
    lastEngagementSync: engagementWatermark?.[0]?.synced_at ?? null,
    clientCount: clientCount ?? 0,
    engagementCount: engagementCount ?? 0,
    recentWebhooks: recentWebhooks ?? [],
  })
}
