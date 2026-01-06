import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    const { data: connections, error } = await supabase
      .from("calendly_connections")
      .select(`
        id,
        calendly_user_name,
        calendly_user_email,
        calendly_user_avatar,
        calendly_user_timezone,
        is_active,
        sync_enabled,
        last_synced_at,
        created_at,
        team_members (
          id,
          full_name,
          email,
          avatar_url,
          title
        )
      `)
      .order("created_at", { ascending: false })

    if (error) {
      console.error("Failed to fetch connections:", error)
      return NextResponse.json({ error: "Failed to fetch connections" }, { status: 500 })
    }

    return NextResponse.json({ connections: connections || [] })
  } catch (error) {
    console.error("Connections fetch error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// Toggle sync for a connection
export async function PATCH(request: NextRequest) {
  try {
    const { connectionId, syncEnabled } = await request.json()

    const supabase = await createClient()

    const { error } = await supabase
      .from("calendly_connections")
      .update({ sync_enabled: syncEnabled, updated_at: new Date().toISOString() })
      .eq("id", connectionId)

    if (error) {
      return NextResponse.json({ error: "Failed to update connection" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Connection update error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
