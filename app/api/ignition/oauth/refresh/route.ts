import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { refreshAccessToken, type IgnitionConnectionRow } from "@/lib/ignition/oauth"

/**
 * Forces a token refresh for the single practice-wide Ignition connection.
 * Mostly used by the admin "Test connection" button; production traffic
 * refreshes implicitly via getValidAccessToken() in the shared library.
 */
export async function POST(_request: NextRequest) {
  try {
    const supabase = await createClient()

    const { data: connection, error } = await supabase
      .from("ignition_connections")
      .select("*")
      .eq("singleton", true)
      .maybeSingle()

    if (error || !connection) {
      return NextResponse.json({ error: "No Ignition connection found" }, { status: 404 })
    }

    const accessToken = await refreshAccessToken(connection as IgnitionConnectionRow, supabase)
    if (!accessToken) {
      return NextResponse.json(
        { error: "Token refresh failed; reauthorization required" },
        { status: 401 },
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("[ignition] refresh error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
