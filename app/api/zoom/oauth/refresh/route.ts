import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
  try {
    const supabaseAdmin = createAdminClient()
    const { connection_id } = await request.json()

    if (!connection_id) {
      return NextResponse.json({ error: "connection_id is required" }, { status: 400 })
    }

    // Get the connection
    const { data: connection, error: fetchError } = await supabaseAdmin
      .from("zoom_connections")
      .select("*")
      .eq("id", connection_id)
      .single()

    if (fetchError || !connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    // Check if token needs refresh (within 5 minutes of expiry)
    const expiresAt = new Date(connection.expires_at)
    const now = new Date()
    const fiveMinutes = 5 * 60 * 1000

    if (expiresAt.getTime() - now.getTime() > fiveMinutes) {
      return NextResponse.json({
        access_token: connection.access_token,
        message: "Token still valid",
      })
    }

    // Refresh the token
    const clientId = process.env.ZOOM_CLIENT_ID!
    const clientSecret = process.env.ZOOM_CLIENT_SECRET!

    const refreshResponse = await fetch("https://zoom.us/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: connection.refresh_token,
      }),
    })

    if (!refreshResponse.ok) {
      const errorData = await refreshResponse.text()
      console.error("[Zoom OAuth] Refresh failed:", errorData)

      // Mark connection as inactive
      await supabaseAdmin.from("zoom_connections").update({ is_active: false }).eq("id", connection_id)

      return NextResponse.json({ error: "Token refresh failed" }, { status: 401 })
    }

    const tokens = await refreshResponse.json()
    const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    // Update tokens in database
    await supabaseAdmin
      .from("zoom_connections")
      .update({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || connection.refresh_token,
        expires_at: newExpiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", connection_id)

    return NextResponse.json({
      access_token: tokens.access_token,
      message: "Token refreshed successfully",
    })
  } catch (error) {
    console.error("[Zoom OAuth] Refresh error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
