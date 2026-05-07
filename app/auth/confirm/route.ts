import { type EmailOtpType } from "@supabase/supabase-js"
import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

/**
 * Canonical Supabase SSR token-hash handler.
 *
 * This is the URL that all branded auth emails (password reset, invite,
 * email change, signup confirmation) point to. The email contains a one-time
 * `token_hash` that we exchange for a real session cookie via verifyOtp().
 *
 * Query params:
 *   - token_hash (required) - opaque hashed token from generateLink()
 *   - type       (required) - 'recovery' | 'invite' | 'email' | 'signup' | 'magiclink'
 *   - next       (optional) - path to redirect to after successful verification
 *                              (defaults to '/' for normal auth, '/auth/reset-password'
 *                              for recovery/invite so users can set a password)
 *
 * Docs: https://supabase.com/docs/guides/auth/server-side/email-based-auth-with-pkce-flow-for-ssr
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const token_hash = searchParams.get("token_hash")
  const type = searchParams.get("type") as EmailOtpType | null
  const explicitNext = searchParams.get("next")

  // Default destinations per OTP type. recovery + invite both need to land
  // on the password update page so the user can set a credential.
  const defaultNext =
    type === "recovery" || type === "invite" ? "/auth/reset-password" : "/"
  const next = explicitNext ?? defaultNext

  if (!token_hash || !type) {
    return NextResponse.redirect(`${origin}/auth/auth-code-error?reason=missing_params`)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({ token_hash, type })

  if (error) {
    console.error("[auth/confirm] verifyOtp failed", { type, message: error.message })
    return NextResponse.redirect(
      `${origin}/auth/auth-code-error?reason=${encodeURIComponent(error.message)}`,
    )
  }

  // Mark the redirect with `invited=true` so the reset-password page can
  // show "Welcome / set your password" copy instead of "Reset your password".
  const target = new URL(next, origin)
  if (type === "invite") {
    target.searchParams.set("invited", "true")
  }
  return NextResponse.redirect(target.toString())
}
