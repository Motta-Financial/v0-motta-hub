/**
 * ProConnect OAuth - Disconnect
 *
 * Revokes the stored ProConnect tokens with Intuit and clears them from
 * Supabase. Customers land here when they disconnect from the Intuit App
 * Marketplace, or when they click "Disconnect" in /tax/settings.
 *
 * Configured in Intuit Developer:
 *   App URLs > Disconnect URL: https://hub.motta.cpa/api/proconnect/oauth/disconnect
 */
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke"

async function performDisconnect(): Promise<{ ok: boolean; error?: string }> {
  const clientId = process.env.PROCONNECT_CLIENT_ID
  const clientSecret = process.env.PROCONNECT_CLIENT_SECRET

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  // Fetch the current token (so we can revoke it before deleting)
  const { data: stored } = await supabase
    .from("proconnect_oauth_tokens")
    .select("refresh_token")
    .eq("is_singleton", true)
    .single()

  // Revoke with Intuit (best effort — even if this fails we still clear local state)
  if (stored?.refresh_token && clientId && clientSecret) {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64")
    try {
      await fetch(REVOKE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${credentials}`,
          Accept: "application/json",
        },
        body: JSON.stringify({ token: stored.refresh_token }),
      })
    } catch (err) {
      console.warn("[ProConnect OAuth] Token revocation failed (continuing with local clear):", err)
    }
  }

  // Clear local tokens regardless
  const { error } = await supabase
    .from("proconnect_oauth_tokens")
    .delete()
    .eq("is_singleton", true)

  if (error) {
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

export async function GET(_request: NextRequest) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://hub.motta.cpa"
  const result = await performDisconnect()

  const url = new URL("/tax/settings", baseUrl)
  url.searchParams.set("disconnected", result.ok ? "1" : "0")
  if (!result.ok && result.error) url.searchParams.set("error", result.error)
  return NextResponse.redirect(url)
}

export async function POST(_request: NextRequest) {
  const result = await performDisconnect()
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }
  return NextResponse.json({ disconnected: true })
}
