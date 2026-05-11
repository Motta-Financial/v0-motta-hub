import { type NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import { createClient } from "@/lib/supabase/server"
import { exchangeAuthorizationCode } from "@/lib/ignition/oauth"

/**
 * Lands the user back on /admin/ignition with either ?connected=true or
 * ?error=<code>. We never surface raw OAuth errors to the user — only a
 * coarse error code — so they can be diagnosed from the server logs
 * without leaking provider details into the URL bar.
 */
const SUCCESS_REDIRECT = "/admin/ignition?connected=true"
const FAIL_REDIRECT = "/admin/ignition"

function fail(req: NextRequest, code: string) {
  return NextResponse.redirect(new URL(`${FAIL_REDIRECT}?error=${code}`, req.url))
}

/**
 * Verifies the signed state value created by the authorize route. Returns
 * the decoded teamMemberId if the signature is valid AND the timestamp is
 * less than 10 minutes old, otherwise null.
 */
function verifyState(state: string): { teamMemberId: string } | null {
  const dot = state.indexOf(".")
  if (dot === -1) return null
  const payloadB64 = state.slice(0, dot)
  const signature = state.slice(dot + 1)
  const stateSecret =
    process.env.SUPABASE_JWT_SECRET ||
    process.env.IGNITION_CLIENT_SECRET ||
    "ignition-state-secret"
  const expected = crypto
    .createHmac("sha256", stateSecret)
    .update(payloadB64)
    .digest("base64url")

  const expectedBuf = Buffer.from(expected)
  const actualBuf = Buffer.from(signature)
  if (expectedBuf.length !== actualBuf.length) return null
  if (!crypto.timingSafeEqual(expectedBuf, actualBuf)) return null

  try {
    const decoded = JSON.parse(Buffer.from(payloadB64, "base64url").toString())
    if (typeof decoded.teamMemberId !== "string") return null
    if (Date.now() - decoded.timestamp > 10 * 60 * 1000) return null
    return { teamMemberId: decoded.teamMemberId }
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const code = params.get("code")
  const state = params.get("state")
  const error = params.get("error")

  if (error) {
    console.error("[ignition] OAuth provider error:", error, params.get("error_description"))
    return fail(request, "oauth_denied")
  }
  if (!code || !state) return fail(request, "missing_params")

  const decoded = verifyState(state)
  if (!decoded) return fail(request, "invalid_state")

  try {
    const tokens = await exchangeAuthorizationCode(code)
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000)
    const supabase = await createClient()

    // The Ignition Reporting API doesn't expose a /me endpoint, so we leave
    // the practice metadata fields null on first insert. A follow-up call
    // during sync (or a future Ignition API addition) can backfill them.
    //
    // singleton=true with a UNIQUE index gives us "exactly one row" semantics
    // on upsert so re-authorization simply rewrites the existing connection
    // in place.
    const { error: upsertError } = await supabase
      .from("ignition_connections")
      .upsert(
        {
          singleton: true,
          team_member_id: decoded.teamMemberId,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_type: tokens.token_type ?? null,
          scope: tokens.scope ?? "reporting",
          expires_at: expiresAt.toISOString(),
          is_active: true,
          sync_enabled: true,
          last_sync_error: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "singleton" },
      )
      .select("id")
      .single()

    if (upsertError) {
      console.error("[ignition] connection upsert failed:", upsertError)
      return fail(request, "save_failed")
    }

    return NextResponse.redirect(new URL(SUCCESS_REDIRECT, request.url))
  } catch (err) {
    console.error("[ignition] callback failure:", err)
    return fail(request, "callback_failed")
  }
}
