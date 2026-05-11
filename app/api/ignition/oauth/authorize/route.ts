import { type NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import { createClient } from "@/lib/supabase/server"
import { buildAuthorizeUrl } from "@/lib/ignition/oauth"

/**
 * Begins the Ignition OAuth flow for the currently-authenticated team
 * member. The state parameter is an HMAC-signed payload binding the
 * redirect back to *this* user — without it, an attacker could trick a
 * victim into linking their own Ignition account to a different
 * Motta Hub account.
 *
 * Ignition's OAuth grants practice-wide access, so any admin in the
 * practice can initiate this flow. We still attribute the install to the
 * team_member who clicked Connect for auditing purposes.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.redirect(new URL("/login?next=/admin/ignition", request.url))
    }

    const { data: teamMember } = await supabase
      .from("team_members")
      .select("id")
      .eq("auth_user_id", user.id)
      .single()

    if (!teamMember) {
      return NextResponse.json({ error: "Team member not found" }, { status: 404 })
    }

    // Sign the state payload with a server-only secret. We reuse the
    // Supabase JWT secret (same pattern as Calendly's authorize route)
    // so we don't have to introduce yet another env var.
    const stateSecret =
      process.env.SUPABASE_JWT_SECRET ||
      process.env.IGNITION_CLIENT_SECRET ||
      "ignition-state-secret"
    const payload = {
      teamMemberId: teamMember.id,
      timestamp: Date.now(),
      nonce: crypto.randomBytes(16).toString("hex"),
    }
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url")
    const signature = crypto
      .createHmac("sha256", stateSecret)
      .update(payloadB64)
      .digest("base64url")
    const state = `${payloadB64}.${signature}`

    return NextResponse.redirect(buildAuthorizeUrl({ state }))
  } catch (error) {
    console.error("[ignition] authorize error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to initiate OAuth" },
      { status: 500 },
    )
  }
}
