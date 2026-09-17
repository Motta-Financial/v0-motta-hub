import { type EmailOtpType } from "@supabase/supabase-js"
import { createAdminClient, createClient } from "@/lib/supabase/server"
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
/**
 * Stamp auth_user_id onto a team_members row that only has an email.
 *
 * Signing in with Microsoft mints a NEW auth user — a different uuid from
 * whatever a password account used — so a staff member whose row was never
 * linked resolves only by the email fallback. That fallback works
 * (middleware and getTeamMemberByAuthId both have it), but it is a fallback:
 * it breaks the moment someone's work address changes, and it means every
 * lookup pays for two queries instead of one.
 *
 * Measured against prod: 3 of 19 active team members had no auth_user_id.
 *
 * Deliberately narrow:
 *  · matches on email only, and only a row that has NO auth_user_id yet, so
 *    it can never repoint an already-linked colleague's row at a different
 *    identity;
 *  · runs through the admin client because team_members is is_staff()-gated
 *    and the caller is, by definition, not yet resolvable as staff;
 *  · failures are logged and swallowed. The email fallback still works, so
 *    a failed backfill must not turn into a failed login.
 */
async function linkTeamMemberToAuthUser(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<void> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user?.email) return

    const admin = createAdminClient()

    const { data: existing } = await admin
      .from("team_members")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle()
    if (existing) return

    await admin
      .from("team_members")
      .update({ auth_user_id: user.id, updated_at: new Date().toISOString() })
      .eq("email", user.email)
      .is("auth_user_id", null)
  } catch (err) {
    console.error("[auth] could not link team member to auth user:", err)
  }
}

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

  // 2) PKCE code-exchange flow — legacy email links AND Microsoft sign-in,
  //    which returns here with ?code after Supabase's own callback.
  if (code) {
    const supabase = await createClient()
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
    if (exchangeError) {
      return NextResponse.redirect(
        `${origin}/auth/auth-code-error?reason=${encodeURIComponent(exchangeError.message)}`,
      )
    }

    await linkTeamMemberToAuthUser(supabase)

    const target = new URL(defaultNext, origin)
    if (type === "invite") target.searchParams.set("invited", "true")
    return NextResponse.redirect(target.toString())
  }

  // 3) No code/token_hash -> probably an implicit-flow link with hash fragment.
  //    Hash fragments aren't visible server-side, so hand off to the reset
  //    page (or the requested `next` page), which has client-side handling.
  return NextResponse.redirect(`${origin}${defaultNext}`)
}
