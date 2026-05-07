import { type EmailOtpType } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

/**
 * Legacy + compatibility auth callback.
 *
 * Three formats are accepted (in priority order):
 *  1. token_hash + type   -> verifyOtp() (canonical PKCE-via-token-hash flow)
 *  2. code + type          -> exchangeCodeForSession() (legacy PKCE flow,
 *                              kept so old emails / OAuth still work)
 *  3. (none)               -> let the client page handle hash fragments
 *                              (#access_token=...) for back-compat with the
 *                              implicit flow.
 *
 * For password reset / invite flows, prefer pointing email links at
 * /auth/confirm directly (cleaner, no fallback paths).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const tokenHash = searchParams.get("token_hash")
  const type = searchParams.get("type") as EmailOtpType | null
  const error = searchParams.get("error")
  const errorDescription = searchParams.get("error_description")

  // Surface upstream Supabase errors immediately
  if (error) {
    return NextResponse.redirect(
      `${origin}/auth/auth-code-error?reason=${encodeURIComponent(errorDescription || error)}`,
    )
  }

  const isRecoveryLike = type === "recovery" || type === "invite"
  const defaultNext = isRecoveryLike ? "/auth/reset-password" : (searchParams.get("next") ?? "/")

  // 1) Modern token-hash flow (what we send from our own Resend emails)
  if (tokenHash && type) {
    const supabase = await createClient()
    const { error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    })
    if (verifyError) {
      return NextResponse.redirect(
        `${origin}/auth/auth-code-error?reason=${encodeURIComponent(verifyError.message)}`,
      )
    }
    const target = new URL(defaultNext, origin)
    if (type === "invite") target.searchParams.set("invited", "true")
    return NextResponse.redirect(target.toString())
  }

  // 2) Legacy PKCE code-exchange flow
  if (code) {
    const supabase = await createClient()
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
    if (exchangeError) {
      return NextResponse.redirect(
        `${origin}/auth/auth-code-error?reason=${encodeURIComponent(exchangeError.message)}`,
      )
    }
    const target = new URL(defaultNext, origin)
    if (type === "invite") target.searchParams.set("invited", "true")
    return NextResponse.redirect(target.toString())
  }

  // 3) No code/token_hash -> probably an implicit-flow link with hash fragment.
  //    Hash fragments aren't visible server-side, so hand off to the reset
  //    page (or the requested `next` page), which has client-side handling.
  return NextResponse.redirect(`${origin}${defaultNext}`)
}
