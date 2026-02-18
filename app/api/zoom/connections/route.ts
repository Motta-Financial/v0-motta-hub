import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export async function GET() {
  try {
    const supabaseAdmin = createAdminClient()
    const { data: connections, error } = await supabaseAdmin
      .from("zoom_connections")
      .select(`
        id,
        zoom_user_id,
        zoom_email,
        zoom_display_name,
        zoom_pic_url,
        zoom_timezone,
        zoom_personal_meeting_url,
        is_active,
        sync_enabled,
        last_synced_at,
        created_at,
        team_member_id,
        team_members(id, full_name, avatar_url, email)
      `)
      .order("created_at", { ascending: false })

    if (error) {
      console.error("[Zoom Connections] Fetch error:", error)
      return NextResponse.json({ error: "Failed to fetch connections" }, { status: 500 })
    }

    return NextResponse.json({ connections: connections || [] })
  } catch (error) {
    console.error("[Zoom Connections] Error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// Toggle sync enabled for a connection
export async function PATCH(request: Request) {
  try {
    const { connection_id, sync_enabled } = await request.json()

    if (!connection_id) {
      return NextResponse.json({ error: "connection_id is required" }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from("zoom_connections")
      .update({ sync_enabled, updated_at: new Date().toISOString() })
      .eq("id", connection_id)

    if (error) {
      return NextResponse.json({ error: "Failed to update connection" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[Zoom Connections] Patch error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
