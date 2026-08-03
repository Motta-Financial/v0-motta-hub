import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import {
  buildCorsHeaders,
  handleCorsPreflight,
  isTrustedPublicRequest,
  rateLimitFor,
} from "@/lib/cors"
import { sendEmail } from "@/lib/email"
import crypto from "node:crypto"

/**
 * POST /api/public/newsletter
 *
 * Newsletter signup for motta.cpa. Public surface; trusted under
 * either CORS allowlist (browser-direct from motta.cpa) or
 * shared-secret (server-to-server from the marketing project's API
 * routes).
 *
 * Storage:  marketing.newsletter_subscribers
 * Email:    Resend confirmation link → /api/public/newsletter/confirm
 *
 * Double-opt-in is required so that a public form submission can
 * never silently start mailing somebody — important for CAN-SPAM
 * compliance and for not getting motta.cpa flagged by Resend.
 */
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

interface SignupBody {
  email: string
  full_name?: string
  source?: string
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  // Honeypot — must be empty.
  website?: string
}

function validEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

function clientIp(req: NextRequest) {
  const xff = req.headers.get("x-forwarded-for")
  if (xff) return xff.split(",")[0].trim()
  return req.headers.get("x-real-ip") ?? "unknown"
}

export async function OPTIONS(req: NextRequest) {
  return handleCorsPreflight(req)
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin")
  const cors = buildCorsHeaders(origin)

  if (!isTrustedPublicRequest(req)) {
    return NextResponse.json(
      { error: "untrusted_request" },
      { status: 403, headers: cors },
    )
  }

  const ip = clientIp(req)
  const limited = rateLimitFor(`public:newsletter:${ip}`, {
    limit: 5,
    windowSec: 600, // 5 signups / 10 min / IP
  })
  if (!limited.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      {
        status: 429,
        headers: { ...cors, "Retry-After": String(limited.retryAfter) },
      },
    )
  }

  let body: SignupBody
  try {
    body = (await req.json()) as SignupBody
  } catch {
    return NextResponse.json(
      { error: "invalid_json" },
      { status: 400, headers: cors },
    )
  }

  // Honeypot — accept silently and bail. Never log the actor.
  if (body.website && body.website.trim().length > 0) {
    return NextResponse.json({ ok: true }, { status: 200, headers: cors })
  }

  const email = (body.email ?? "").trim().toLowerCase()
  if (!validEmail(email) || email.length > 320) {
    return NextResponse.json(
      { error: "invalid_email" },
      { status: 400, headers: cors },
    )
  }

  const supabase = createAdminClient()

  // Generate a single-use confirmation token. The Hub keeps the
  // hash; the email contains the raw token. Constant-time compare on
  // the confirm route prevents timing attacks against random guesses.
  const rawToken = crypto.randomBytes(24).toString("hex")
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex")

  // Upsert by lowercased email (the unique partial index handles
  // active subscribers; if previously unsubscribed we re-create).
  const { data: existing, error: fetchErr } = await supabase
    .schema("marketing")
    .from("newsletter_subscribers")
    .select("id, confirmed_at, unsubscribed_at")
    .ilike("email", email)
    .is("unsubscribed_at", null)
    .maybeSingle()

  if (fetchErr) {
    console.error("[v0] [public/newsletter] lookup failed:", fetchErr)
    return NextResponse.json(
      { error: "lookup_failed" },
      { status: 500, headers: cors },
    )
  }

  let subscriberId: string
  if (existing) {
    // Already on the list. Refresh the token but DON'T re-send if
    // they already confirmed — that would be spammy. We return ok=true
    // with `already_confirmed` so the marketing site can show
    // "you're already subscribed" instead of a confirmation prompt.
    subscriberId = existing.id
    if (existing.confirmed_at) {
      return NextResponse.json(
        { ok: true, already_confirmed: true },
        { status: 200, headers: cors },
      )
    }
    const { error: updErr } = await supabase
      .schema("marketing")
      .from("newsletter_subscribers")
      .update({
        confirmation_token: tokenHash,
        full_name: body.full_name?.trim() || null,
        source: body.source?.trim() || null,
        utm_source: body.utm_source?.trim() || null,
        utm_medium: body.utm_medium?.trim() || null,
        utm_campaign: body.utm_campaign?.trim() || null,
        ip_address: ip,
        user_agent: req.headers.get("user-agent") || null,
      })
      .eq("id", subscriberId)
    if (updErr) {
      console.error("[v0] [public/newsletter] update failed:", updErr)
      return NextResponse.json(
        { error: "update_failed" },
        { status: 500, headers: cors },
      )
    }
  } else {
    const { data: ins, error: insErr } = await supabase
      .schema("marketing")
      .from("newsletter_subscribers")
      .insert({
        email,
        full_name: body.full_name?.trim() || null,
        source: body.source?.trim() || null,
        utm_source: body.utm_source?.trim() || null,
        utm_medium: body.utm_medium?.trim() || null,
        utm_campaign: body.utm_campaign?.trim() || null,
        confirmation_token: tokenHash,
        ip_address: ip,
        user_agent: req.headers.get("user-agent") || null,
      })
      .select("id")
      .single()
    if (insErr || !ins) {
      console.error("[v0] [public/newsletter] insert failed:", insErr)
      return NextResponse.json(
        { error: "insert_failed" },
        { status: 500, headers: cors },
      )
    }
    subscriberId = ins.id
  }

  // Send the confirmation email. The link points at the marketing
  // site (motta.cpa/newsletter/confirm?token=...) which then proxies
  // to the Hub's confirm route — that way the link the user sees
  // matches the brand domain.
  const siteBase =
    process.env.MOTTA_SITE_URL ?? "https://motta.cpa"
  const confirmUrl = `${siteBase}/newsletter/confirm?token=${encodeURIComponent(rawToken)}`

  try {
    await sendEmail({
      to: email,
      subject: "Confirm your Motta newsletter subscription",
      html: `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#EAE6E1;padding:24px;">
        <div style="max-width:520px;margin:0 auto;background:#FFFFFF;border:1px solid #D8D3CB;border-radius:12px;padding:32px;">
          <h1 style="margin:0 0 8px;font-size:20px;color:#1F2520;">Confirm your subscription</h1>
          <p style="color:#6B7066;font-size:14px;line-height:1.55;">Thanks for signing up for the Motta newsletter. Click the button below to confirm your email so we can start sending you our updates.</p>
          <p style="margin:24px 0;"><a href="${confirmUrl}" style="display:inline-block;background:#6B745D;color:#FFFFFF;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Confirm subscription</a></p>
          <p style="color:#6B7066;font-size:12px;">If you didn&#39;t request this, you can ignore this email and you won&#39;t hear from us again.</p>
        </div>
      </body></html>`,
    })
  } catch (err) {
    // Don't 500 — the row is created and confirm endpoint still
    // works if the user has the link. But we DO log loudly.
    console.error("[v0] [public/newsletter] resend failed:", err)
  }

  return NextResponse.json(
    { ok: true, subscriber_id: subscriberId },
    { status: 200, headers: cors },
  )
}
