import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { sendEmail, buildPasswordResetEmailHtml } from "@/lib/email"

/**
 * POST /api/auth/forgot-password
 * Body: { email: string }
 *
 * Self-service password-reset entry point. Bypasses Supabase's built-in
 * email pipeline entirely so the flow doesn't depend on:
 *   - the project's Supabase email template config
 *   - PKCE code-verifier cookies (which break when users click the email
 *     on a different device than the one they requested it on)
 *
 * Instead we:
 *   1. Verify the email belongs to an active team member.
 *   2. Ask Supabase admin API for a recovery `token_hash`.
 *   3. Send the user a Resend-branded email pointing at /auth/confirm.
 *
 * Always returns 200 with a generic message regardless of whether the
 * email exists, to avoid email-enumeration attacks.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const email = (body?.email ?? "").toString().trim().toLowerCase()

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "A valid email address is required." }, { status: 400 })
    }

    const siteUrl = resolveSiteUrl(request)
    const admin = createAdminClient()

    // 1. Confirm a team member exists & is active. We don't tell the caller
    //    either way — but we skip the email send if the lookup fails.
    const { data: member } = await admin
      .from("team_members")
      .select("full_name, email, is_active")
      .ilike("email", email)
      .maybeSingle()

    if (!member || member.is_active === false) {
      // Don't leak existence; pretend we sent it.
      return NextResponse.json({
        success: true,
        message: "If that email is registered with Motta Hub, a reset link is on its way.",
      })
    }

    // 2. Generate a recovery token_hash via the admin API. This does NOT
    //    send an email by itself — we control the delivery via Resend below.
    const redirectTo = `${siteUrl}/auth/confirm?next=${encodeURIComponent("/auth/reset-password")}`
    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo },
    })

    if (linkError || !linkData?.properties) {
      console.error("[forgot-password] generateLink failed:", linkError)
      return NextResponse.json(
        { error: "We couldn't generate a reset link. Please contact an administrator." },
        { status: 500 },
      )
    }

    const tokenHash = linkData.properties.hashed_token
    if (!tokenHash) {
      console.error("[forgot-password] generateLink returned no hashed_token")
      return NextResponse.json(
        { error: "Reset link generation failed." },
        { status: 500 },
      )
    }

    // 3. Build our own URL pointing at /auth/confirm — this is the URL
    //    we control and that hits our verifyOtp() handler.
    const actionUrl = new URL(`${siteUrl}/auth/confirm`)
    actionUrl.searchParams.set("token_hash", tokenHash)
    actionUrl.searchParams.set("type", "recovery")
    actionUrl.searchParams.set("next", "/auth/reset-password")

    const html = buildPasswordResetEmailHtml({
      recipientName: member.full_name || undefined,
      actionUrl: actionUrl.toString(),
      mode: "reset",
      expiresInHours: 1,
    })

    const sendResult = await sendEmail({
      to: email,
      subject: "Reset your Motta Hub password",
      html,
    })

    if (!sendResult.success) {
      console.error("[forgot-password] sendEmail failed:", sendResult.error)
      return NextResponse.json(
        {
          error:
            "We generated a reset link but couldn't deliver the email. Please contact an administrator.",
        },
        { status: 500 },
      )
    }

    return NextResponse.json({
      success: true,
      message: "If that email is registered with Motta Hub, a reset link is on its way.",
    })
  } catch (err) {
    console.error("[forgot-password] unexpected error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 },
    )
  }
}

/**
 * Build a stable site URL for the email link.
 *
 * Priority:
 *   1. Request `Origin` header (works for previews, prod, localhost).
 *   2. NEXT_PUBLIC_APP_URL / APP_BASE_URL env (configured in Vercel).
 *   3. Hardcoded prod fallback.
 *
 * We bias toward the request origin so dev / preview deployments mail their
 * own URLs, not the prod domain.
 */
function resolveSiteUrl(request: NextRequest): string {
  const origin = request.headers.get("origin")
  if (origin) return origin.replace(/\/$/, "")

  const envUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.APP_BASE_URL
  if (envUrl) {
    const normalized = envUrl.startsWith("http") ? envUrl : `https://${envUrl}`
    return normalized.replace(/\/$/, "")
  }

  return "https://hub.motta.cpa"
}
