import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { refreshAccessToken, type CalendlyConnectionRow } from "@/lib/calendly-api"

/**
 * Forces a token refresh for a single connection. Mostly used by
 * diagnostics / "test connection" buttons; production traffic refreshes
 * implicitly via getValidAccessToken() in the shared library.
 *
 * Hardcoded fallback secrets that used to live in this file have been
 * removed — credentials must come exclusively from environment vars
 * via getCalendlyOAuthConfig().
 */
export async function POST(request: NextRequest) {
  try {
    const { connectionId } = await request.json()
    if (!connectionId) {
      return NextResponse.json({ error: "connectionId required" }, { status: 400 })
    }

    const supabase = await createClient()

    const { data: connection, error } = await supabase
      .from("calendly_connections")
      .select("*")
      .eq("id", connectionId)
      .single()

    if (error || !connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    const accessToken = await refreshAccessToken(connection as CalendlyConnectionRow, supabase)
    if (!accessToken) {
      return NextResponse.json(
        { error: "Token refresh failed; reauthorization required" },
        { status: 401 },
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("[calendly] refresh error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
