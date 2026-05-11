import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { revokeToken } from "@/lib/ignition/oauth"

/**
 * Removes the practice-wide Ignition connection and best-effort revokes the
 * underlying token at Ignition's auth server. Because the connection is a
 * singleton, anyone with hub access can technically disconnect it —
 * intentional, since it's a shared practice resource and there's no
 * Ignition-side concept of per-user tokens.
 */
export async function POST(_request: NextRequest) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: connection } = await supabase
      .from("ignition_connections")
      .select("id, access_token")
      .eq("singleton", true)
      .maybeSingle()

    if (connection?.access_token) {
      await revokeToken(connection.access_token)
    }

    const { error } = await supabase
      .from("ignition_connections")
      .delete()
      .eq("singleton", true)

    if (error) {
      console.error("[ignition] disconnect delete failed:", error)
      return NextResponse.json({ error: "Failed to disconnect" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("[ignition] disconnect error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
