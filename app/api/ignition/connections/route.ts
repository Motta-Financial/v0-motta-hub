import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

/**
 * Returns the current Ignition connection (or null) for the admin UI.
 * Never returns the raw access_token or refresh_token — only metadata the
 * UI needs to decide whether to render "Connect" or "Disconnect" and to
 * show health indicators.
 */
export async function GET() {
  try {
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("ignition_connections")
      .select(
        "id, team_member_id, scope, expires_at, ignition_practice_id, ignition_practice_name, ignition_user_email, ignition_user_name, is_active, sync_enabled, last_synced_at, last_sync_error, created_at, updated_at",
      )
      .eq("singleton", true)
      .maybeSingle()

    if (error) {
      console.error("[ignition] connections fetch error:", error)
      return NextResponse.json({ error: "Failed to load connection" }, { status: 500 })
    }

    if (!data) {
      return NextResponse.json({ connection: null })
    }

    // Look up the team member who installed the app so the UI can show
    // "Installed by X" attribution. Done as a second query so the column
    // selection on `ignition_connections` stays narrow.
    let installedBy: { id: string; full_name: string | null; email: string | null } | null = null
    if (data.team_member_id) {
      const { data: tm } = await supabase
        .from("team_members")
        .select("id, full_name, email")
        .eq("id", data.team_member_id)
        .maybeSingle()
      installedBy = tm ?? null
    }

    const expiresAt = new Date(data.expires_at).getTime()
    const isExpired = expiresAt <= Date.now()

    return NextResponse.json({
      connection: {
        id: data.id,
        scope: data.scope,
        expiresAt: data.expires_at,
        isExpired,
        practiceId: data.ignition_practice_id,
        practiceName: data.ignition_practice_name,
        userEmail: data.ignition_user_email,
        userName: data.ignition_user_name,
        isActive: data.is_active,
        syncEnabled: data.sync_enabled,
        lastSyncedAt: data.last_synced_at,
        lastSyncError: data.last_sync_error,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        installedBy,
      },
    })
  } catch (err) {
    console.error("[ignition] connections route error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
