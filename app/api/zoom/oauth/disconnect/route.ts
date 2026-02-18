import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
  try {
    const supabaseAdmin = createAdminClient()
    const { team_member_id } = await request.json()

    if (!team_member_id) {
      return NextResponse.json({ error: "team_member_id is required" }, { status: 400 })
    }

    // Get the connection to revoke token
    const { data: connection } = await supabaseAdmin
      .from("zoom_connections")
      .select("access_token")
      .eq("team_member_id", team_member_id)
      .single()

    if (connection?.access_token) {
      // Revoke the token with Zoom
      const clientId = process.env.ZOOM_CLIENT_ID!
      const clientSecret = process.env.ZOOM_CLIENT_SECRET!

      await fetch("https://zoom.us/oauth/revoke", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        },
        body: new URLSearchParams({
          token: connection.access_token,
        }),
      }).catch((err) => console.error("[Zoom OAuth] Revoke error:", err))
    }

    // Delete the connection from database
    const { error: deleteError } = await supabaseAdmin
      .from("zoom_connections")
      .delete()
      .eq("team_member_id", team_member_id)

    if (deleteError) {
      return NextResponse.json({ error: "Failed to disconnect" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[Zoom OAuth] Disconnect error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
