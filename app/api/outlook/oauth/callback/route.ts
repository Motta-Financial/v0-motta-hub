import { getOAuthStateSecret } from "@/lib/oauth-state-secret"
import { type NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import { createClient } from "@/lib/supabase/server"
import { encryptToken } from "@/lib/outlook-token-cipher"
import {
  ensureWebhookSubscription,
  exchangeAuthorizationCode,
  fetchMe,
  type OutlookConnectionRow,
} from "@/lib/outlook-api"

const SUCCESS_REDIRECT = "/settings/outlook?connected=true"
const FAIL_REDIRECT = "/settings/outlook"

function fail(req: NextRequest, code: string) {
  return NextResponse.redirect(new URL(`${FAIL_REDIRECT}?error=${code}`, req.url))
}

function verifyState(state: string): { teamMemberId: string } | null {
  const dot = state.indexOf(".")
  if (dot === -1) return null
  const payloadB64 = state.slice(0, dot)
  const signature = state.slice(dot + 1)
  const stateSecret = getOAuthStateSecret()
  const expected = crypto.createHmac("sha256", stateSecret).update(payloadB64).digest("base64url")

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
    console.error("[outlook] OAuth provider error:", error, params.get("error_description"))
    return fail(request, "oauth_denied")
  }
  if (!code || !state) return fail(request, "missing_params")

  const decoded = verifyState(state)
  if (!decoded) return fail(request, "invalid_state")

  try {
    const tokens = await exchangeAuthorizationCode(code)
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000)

    const supabase = await createClient()

    const stubConnection: OutlookConnectionRow = {
      id: "",
      team_member_id: decoded.teamMemberId,
      outlook_user_id: "",
      outlook_email: null,
      outlook_display_name: null,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type ?? null,
      expires_at: expiresAt.toISOString(),
      scope: tokens.scope ?? null,
      is_active: true,
      last_synced_at: null,
      sync_enabled: true,
      last_sync_error: null,
      webhook_subscribed: false,
      webhook_subscription_id: null,
      emails_synced_count: 0,
      events_synced_count: 0,
    }
    const me = await fetchMe(stubConnection, supabase)
    if (!me) return fail(request, "user_fetch_failed")

    const { data: connectionRow, error: upsertError } = await supabase
      .from("outlook_connections")
      .upsert(
        {
          team_member_id: decoded.teamMemberId,
          outlook_user_id: me.id,
          outlook_email: me.mail || me.userPrincipalName,
          outlook_display_name: me.displayName,
          access_token: encryptToken(tokens.access_token),
          refresh_token: encryptToken(tokens.refresh_token),
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
      console.error("[outlook] connection upsert failed:", upsertError)
      return fail(request, "save_failed")
    }

    // Subscribe webhooks inline so the user lands on the settings page
    // with real-time notifications already wired up.
    const sub = await ensureWebhookSubscription(connectionRow as OutlookConnectionRow, supabase)
    if (sub.error) {
      console.error("[outlook] post-connect webhook subscribe failed:", sub.error)
    }

    return NextResponse.redirect(new URL(SUCCESS_REDIRECT, request.url))
  } catch (err) {
    console.error("[outlook] callback failure:", err)
    return fail(request, "callback_failed")
  }
}
