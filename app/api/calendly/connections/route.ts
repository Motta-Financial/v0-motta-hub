import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { CALENDLY_REQUESTED_SCOPES } from "@/lib/calendly-api"

/**
 * Connection inventory + per-connection management.
 *
 * GET    → list all calendly_connections with health metadata
 * PATCH  → toggle sync_enabled / is_active
 */

export async function GET() {
  try {
    const supabase = await createClient()

    const { data: connections, error } = await supabase
      .from("calendly_connections")
      .select(
        `id,
         team_member_id,
         calendly_user_uri,
         calendly_user_name,
         calendly_user_email,
         calendly_user_avatar,
         calendly_user_timezone,
         calendly_organization_uri,
         scope,
         expires_at,
         is_active,
         sync_enabled,
         last_synced_at,
         created_at,
         updated_at,
         team_members ( id, full_name, email, avatar_url, title )`,
      )
      .order("created_at", { ascending: false })

    if (error) {
      console.error("[calendly] connections list failed:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Surface health hints inline so the UI doesn't need to recompute.
    const enriched = (connections || []).map((c: any) => {
      const grantedScopes: string[] = c.scope
        ? c.scope.split(/[\s,]+/).filter(Boolean)
        : []
      const missingScopes = CALENDLY_REQUESTED_SCOPES.filter(
        (s) => !grantedScopes.includes(s),
      )
      const expiresAt = c.expires_at ? new Date(c.expires_at).getTime() : 0
      const tokenExpired = expiresAt > 0 && expiresAt < Date.now()
      const lastSynced = c.last_synced_at ? new Date(c.last_synced_at).getTime() : 0
      const syncStale =
        lastSynced > 0 && Date.now() - lastSynced > 6 * 60 * 60 * 1000

      return {
        ...c,
        health: {
          tokenExpired,
          syncStale,
          missingScopes,
          // Connections issued before scopes were enabled will have
          // either no scope string or a much shorter one. Surface that
          // so the UI can prompt for re-auth.
          needsReauthForScopes: missingScopes.length > 0,
        },
      }
    })

    return NextResponse.json({ connections: enriched })
  } catch (err) {
    console.error("[calendly] connections error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { connectionId, syncEnabled, isActive } = await request.json()
    if (!connectionId) {
      return NextResponse.json({ error: "connectionId required" }, { status: 400 })
    }

    const supabase = await createClient()
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (typeof syncEnabled === "boolean") updates.sync_enabled = syncEnabled
    if (typeof isActive === "boolean") updates.is_active = isActive

    const { error } = await supabase
      .from("calendly_connections")
      .update(updates)
      .eq("id", connectionId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("[calendly] connection patch error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
