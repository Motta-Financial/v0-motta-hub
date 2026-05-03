import { type NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import { createClient } from "@/lib/supabase/server"
import {
  ensureWebhookSubscription,
  exchangeAuthorizationCode,
  extractUuid,
  fetchMe,
  type CalendlyConnectionRow,
} from "@/lib/calendly-api"

/**
 * Where to send users after the OAuth round-trip completes. We point at
 * `/calendly` because that page surfaces the resulting connection state
 * and reauthorization affordances; the older `/calendar` route is kept
 * as a fallback for any deep-links still in the wild.
 */
const SUCCESS_REDIRECT = "/calendly?connected=true"
const FAIL_REDIRECT = "/calendly"

function fail(req: NextRequest, code: string) {
  return NextResponse.redirect(new URL(`${FAIL_REDIRECT}?error=${code}`, req.url))
}

/**
 * Validates the signed state value produced by the authorize route.
 * Returns the decoded payload (incl. teamMemberId) if the signature is
 * valid and the timestamp is fresh, otherwise null.
 */
function verifyState(state: string): { teamMemberId: string } | null {
  const dot = state.indexOf(".")
  if (dot === -1) return null
  const payloadB64 = state.slice(0, dot)
  const signature = state.slice(dot + 1)
  const stateSecret =
    process.env.SUPABASE_JWT_SECRET ||
    process.env.CALENDLY_CLIENT_SECRET ||
    "calendly-state-secret"
  const expected = crypto
    .createHmac("sha256", stateSecret)
    .update(payloadB64)
    .digest("base64url")

  // timingSafeEqual is length-sensitive so guard first.
  const expectedBuf = Buffer.from(expected)
  const actualBuf = Buffer.from(signature)
  if (expectedBuf.length !== actualBuf.length) return null
  if (!crypto.timingSafeEqual(expectedBuf, actualBuf)) return null

  try {
    const decoded = JSON.parse(Buffer.from(payloadB64, "base64url").toString())
    if (typeof decoded.teamMemberId !== "string") return null
    // 10-minute window so a forgotten browser tab can't replay state.
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
    console.error("[calendly] OAuth provider error:", error)
    return fail(request, "oauth_denied")
  }
  if (!code || !state) return fail(request, "missing_params")

  const decoded = verifyState(state)
  if (!decoded) return fail(request, "invalid_state")

  try {
    const tokens = await exchangeAuthorizationCode(code)
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000)

    const supabase = await createClient()

    // Look up the Calendly user that belongs to this token.
    const stubConnection: CalendlyConnectionRow = {
      id: "",
      team_member_id: decoded.teamMemberId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt.toISOString(),
      token_type: tokens.token_type ?? null,
      scope: tokens.scope ?? null,
      calendly_user_uri: "",
      calendly_user_uuid: "",
      calendly_user_name: null,
      calendly_user_email: null,
      calendly_user_avatar: null,
      calendly_user_timezone: null,
      calendly_organization_uri: null,
      is_active: true,
      last_synced_at: null,
      sync_enabled: true,
    }
    const me = await fetchMe(stubConnection, supabase)
    if (!me) return fail(request, "user_fetch_failed")

    // Persist the connection. team_member_id is unique so this is an
    // upsert (re-auth simply replaces the existing row in place).
    const { data: connectionRow, error: upsertError } = await supabase
      .from("calendly_connections")
      .upsert(
        {
          team_member_id: decoded.teamMemberId,
          calendly_user_uri: me.uri,
          calendly_user_uuid: extractUuid(me.uri) ?? "",
          calendly_user_name: me.name,
          calendly_user_email: me.email,
          calendly_user_avatar: me.avatar_url,
          calendly_user_timezone: me.timezone,
          calendly_organization_uri: me.current_organization,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_type: tokens.token_type,
          expires_at: expiresAt.toISOString(),
          scope: tokens.scope,
          is_active: true,
          sync_enabled: true,
          last_sync_error: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "team_member_id" },
      )
      .select("*")
      .single()

    if (upsertError || !connectionRow) {
      console.error("[calendly] connection upsert failed:", upsertError)
      return fail(request, "save_failed")
    }

    // Subscribe webhook inline. Previously this was fire-and-forget over
    // HTTP, which meant the subscription frequently never landed (the
    // request was canceled by the redirect, errors were swallowed, and
    // the DB never reflected the result). Calling the helper directly
    // ensures the user lands on /calendly with webhooks already wired
    // up — or at least with a precise error to surface in the UI.
    const sub = await ensureWebhookSubscription(
      connectionRow as CalendlyConnectionRow,
      supabase,
      { scope: "user" },
    )
    if (sub.error) {
      console.error("[calendly] post-connect webhook subscribe failed:", sub.error)
    }

    return NextResponse.redirect(new URL(SUCCESS_REDIRECT, request.url))
  } catch (err) {
    console.error("[calendly] callback failure:", err)
    return fail(request, "callback_failed")
  }
}
