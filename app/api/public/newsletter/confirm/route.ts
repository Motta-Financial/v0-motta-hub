import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import {
  buildCorsHeaders,
  handleCorsPreflight,
  isTrustedPublicRequest,
  rateLimitFor,
} from "@/lib/cors"
import crypto from "node:crypto"

/**
 * GET/POST /api/public/newsletter/confirm?token=...
 *
 * Confirms a newsletter signup. Either GET (clicked from email) or
 * POST (proxy from motta.cpa) works.
 */
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function OPTIONS(req: NextRequest) {
  return handleCorsPreflight(req)
}

async function confirm(req: NextRequest, token: string | null) {
  const origin = req.headers.get("origin")
  const cors = buildCorsHeaders(origin)

  if (!isTrustedPublicRequest(req)) {
    return NextResponse.json(
      { error: "untrusted_request" },
      { status: 403, headers: cors },
    )
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
  const limited = rateLimitFor(`public:newsletter_confirm:${ip}`, {
    limit: 30,
    windowSec: 600,
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

  if (!token || token.length < 16 || token.length > 128) {
    return NextResponse.json(
      { error: "invalid_token" },
      { status: 400, headers: cors },
    )
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex")
  const supabase = createAdminClient()

  const { data: row, error } = await supabase
    .schema("marketing")
    .from("newsletter_subscribers")
    .select("id, confirmed_at")
    .eq("confirmation_token", tokenHash)
    .maybeSingle()
  if (error) {
    console.error("[v0] [public/newsletter/confirm] lookup failed:", error)
    return NextResponse.json(
      { error: "lookup_failed" },
      { status: 500, headers: cors },
    )
  }
  if (!row) {
    return NextResponse.json(
      { error: "token_not_found" },
      { status: 404, headers: cors },
    )
  }
  if (row.confirmed_at) {
    return NextResponse.json(
      { ok: true, already_confirmed: true },
      { status: 200, headers: cors },
    )
  }

  const { error: updErr } = await supabase
    .schema("marketing")
    .from("newsletter_subscribers")
    .update({
      confirmed_at: new Date().toISOString(),
      confirmation_token: null, // single-use
    })
    .eq("id", row.id)
  if (updErr) {
    console.error("[v0] [public/newsletter/confirm] update failed:", updErr)
    return NextResponse.json(
      { error: "confirm_failed" },
      { status: 500, headers: cors },
    )
  }
  return NextResponse.json({ ok: true }, { status: 200, headers: cors })
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  return confirm(req, url.searchParams.get("token"))
}

export async function POST(req: NextRequest) {
  let body: { token?: string } = {}
  try {
    body = (await req.json()) as { token?: string }
  } catch {
    /* tolerate empty bodies */
  }
  return confirm(req, body.token ?? null)
}
