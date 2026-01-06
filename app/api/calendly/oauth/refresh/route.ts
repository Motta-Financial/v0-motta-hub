import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

const CALENDLY_CLIENT_ID = process.env.CALENDLY_CLIENT_ID || "-wMxOuieBrXhpNzjqw3fZkIFHR7RlW4DvOzSVD4AufY"
const CALENDLY_CLIENT_SECRET = process.env.CALENDLY_CLIENT_SECRET || "4TB7G41QdZbGV_md78y3W5ztUa_hOGZToKx83o3eV-U"

export async function POST(request: NextRequest) {
  try {
    const { connectionId } = await request.json()

    const supabase = await createClient()

    // Get connection with refresh token
    const { data: connection, error: fetchError } = await supabase
      .from("calendly_connections")
      .select("*")
      .eq("id", connectionId)
      .single()

    if (fetchError || !connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    // Refresh the token
    const tokenResponse = await fetch("https://auth.calendly.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: CALENDLY_CLIENT_ID,
        client_secret: CALENDLY_CLIENT_SECRET,
        refresh_token: connection.refresh_token,
      }),
    })

    if (!tokenResponse.ok) {
      // Mark connection as inactive if refresh fails
      await supabase.from("calendly_connections").update({ is_active: false }).eq("id", connectionId)

      return NextResponse.json({ error: "Token refresh failed" }, { status: 401 })
    }

    const tokens = await tokenResponse.json()
    const { access_token, refresh_token, expires_in } = tokens

    // Update connection with new tokens
    const expiresAt = new Date(Date.now() + expires_in * 1000)

    const { error: updateError } = await supabase
      .from("calendly_connections")
      .update({
        access_token,
        refresh_token: refresh_token || connection.refresh_token,
        expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", connectionId)

    if (updateError) {
      return NextResponse.json({ error: "Failed to update tokens" }, { status: 500 })
    }

    return NextResponse.json({ success: true, access_token })
  } catch (error) {
    console.error("Token refresh error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
