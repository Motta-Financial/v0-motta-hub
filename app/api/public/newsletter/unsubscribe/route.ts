import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import {
  buildCorsHeaders,
  handleCorsPreflight,
  isTrustedPublicRequest,
  rateLimitFor,
} from "@/lib/cors"

/**
 * POST /api/public/newsletter/unsubscribe
 *
 * Accepts { email } and unsubscribes that address (idempotent).
 * Always returns 200 OK so we don't leak whether an email is on the
 * list — the marketing site shows the same "you're unsubscribed"
 * confirmation either way.
 */
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

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

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
  const limited = rateLimitFor(`public:newsletter_unsub:${ip}`, {
    limit: 20,
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

  let body: { email?: string }
  try {
    body = (await req.json()) as { email?: string }
  } catch {
    return NextResponse.json(
      { error: "invalid_json" },
      { status: 400, headers: cors },
    )
  }

  const email = (body.email ?? "").trim().toLowerCase()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { ok: true }, // intentionally silent; see header comment
      { status: 200, headers: cors },
    )
  }

  const supabase = createAdminClient()
  await supabase
    .schema("marketing")
    .from("newsletter_subscribers")
    .update({ unsubscribed_at: new Date().toISOString() })
    .ilike("email", email)
    .is("unsubscribed_at", null)

  return NextResponse.json({ ok: true }, { status: 200, headers: cors })
}
