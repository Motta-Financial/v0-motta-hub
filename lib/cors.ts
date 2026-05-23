/**
 * CORS allowlist for the public-facing endpoints that the new
 * marketing site (and any future first-party clients) will hit.
 *
 * Motta Hub ships behind auth at hub.motta.cpa. The PUBLIC site at
 * motta.cpa is a separate Vercel project with its own deploy
 * cadence — talking to it via HTTPS keeps the two repos and teams
 * cleanly isolated. These helpers are the single place we decide
 * which origins are allowed to POST contact / intake submissions
 * into the Hub.
 *
 * Origin policy:
 *   • motta.cpa, www.motta.cpa             → production marketing site
 *   • hub.motta.cpa                        → Hub itself (server-to-server
 *                                            from the Hub still works,
 *                                            but same-origin browser
 *                                            calls also need to pass)
 *   • *.vercel.app                         → preview deploys of EITHER
 *                                            project. Tightened to the
 *                                            Motta team scope below.
 *   • http://localhost:3000-3999           → local dev for both repos
 *
 * The previews are gated by a "looks like ours" rule: hostname must
 * end in `.vercel.app` AND start with `newmottawebsite`, `motta-`, or
 * `v0-motta-hub`. This keeps a random preview from another tenant
 * out of the allowlist while still allowing the website team's
 * branch previews to call the production Hub during QA.
 *
 * Add new permanent origins to ALLOWED_HOSTS, not by hand-editing
 * the predicate.
 */

import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

const ALLOWED_HOSTS = new Set<string>([
  "motta.cpa",
  "www.motta.cpa",
  "hub.motta.cpa",
  // Legacy WordPress site — keep until DNS cutover so the existing
  // Contact / Intake forms on www.mottafinancial.com continue to
  // submit to the new Hub endpoints during the transition window.
  "www.mottafinancial.com",
  "mottafinancial.com",
])

const ALLOWED_PREVIEW_PREFIXES = [
  "newmottawebsite",
  "motta-",
  "v0-motta-hub",
]

export function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }

  const host = url.hostname.toLowerCase()

  // Exact-match production / staging hosts.
  if (ALLOWED_HOSTS.has(host)) return true

  // Local dev (any port). Both repos run on Next dev servers, and
  // the website team frequently uses 3001/3002 to run alongside the
  // Hub locally.
  if (host === "localhost" || host === "127.0.0.1") return true

  // Vercel preview deployments scoped to our two projects.
  if (host.endsWith(".vercel.app")) {
    return ALLOWED_PREVIEW_PREFIXES.some((p) => host.startsWith(p))
  }

  return false
}

/**
 * Build the response headers for a CORS-permitted origin. Always
 * echoes the *requesting* origin (never a wildcard) because all
 * public endpoints accept JSON with credentials disabled — but a
 * wildcard would still leak the API surface to phishing pages.
 */
export function buildCorsHeaders(origin: string | null | undefined): Record<string, string> {
  if (!origin || !isAllowedOrigin(origin)) {
    // Return an empty record so the caller can spread it without
    // accidentally enabling CORS for a disallowed origin.
    return {}
  }
  return {
    "Access-Control-Allow-Origin": origin,
    // We do not accept cookies on the public surface — the Hub
    // session lives at hub.motta.cpa and cross-site auth would
    // require a separate flow anyway.
    "Access-Control-Allow-Credentials": "false",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Motta-Source",
    // Vary header is critical so a misconfigured CDN doesn't cache
    // a CORS-allowed response and serve it to a different origin.
    Vary: "Origin",
  }
}

/**
 * Standard preflight handler. Drop this into any public route's
 * `OPTIONS` export.
 */
export function handleCorsPreflight(req: NextRequest): Response {
  const origin = req.headers.get("origin")
  const headers = buildCorsHeaders(origin)
  // 204 with the negotiated headers if allowed; 403 otherwise so
  // browsers fail-fast in dev.
  if (Object.keys(headers).length === 0) {
    return new Response(null, { status: 403 })
  }
  return new Response(null, { status: 204, headers })
}

/**
 * Convenience wrapper used by every public endpoint:
 *
 *   const cors = corsFor(req)
 *   if (!cors.allowed) return cors.deny()
 *   return NextResponse.json(payload, { headers: cors.headers })
 */
export function corsFor(req: NextRequest) {
  const origin = req.headers.get("origin")
  const headers = buildCorsHeaders(origin)
  const allowed = Object.keys(headers).length > 0 || origin === null
  // Note: a missing Origin header (server-to-server, curl) is
  // ALLOWED — those calls aren't subject to browser CORS and the
  // bot/spam protection lives at the rate-limit + honeypot layer
  // instead.
  return {
    origin,
    allowed,
    headers,
    deny: () =>
      new Response(JSON.stringify({ error: "origin_not_allowed" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
  }
}

/**
 * Tiny in-memory sliding-window rate limiter for the public
 * endpoints. Intentionally simple — Vercel serverless instances are
 * short-lived so the bucket resets on every cold start, which is
 * fine for the realistic threat model (script-kiddie spam bots, not
 * a coordinated DDoS — Vercel's edge handles the latter).
 *
 * For sustained traffic we should swap this out for an Upstash
 * Redis-backed counter; until then this gives us forensic logs and
 * meaningful 429s without a new dependency.
 *
 * Returns `{ ok, retryAfter }` so the caller can echo Retry-After
 * back to the client.
 */
const rateBuckets = new Map<string, number[]>()

export function rateLimitFor(
  key: string,
  opts: { limit: number; windowSec: number },
): { ok: true } | { ok: false; retryAfter: number } {
  const now = Date.now()
  const windowMs = opts.windowSec * 1000
  const bucket = rateBuckets.get(key) ?? []
  // Drop timestamps that have rolled out of the window.
  const fresh = bucket.filter((t) => now - t < windowMs)
  if (fresh.length >= opts.limit) {
    const oldest = fresh[0]
    const retryAfter = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000))
    rateBuckets.set(key, fresh)
    return { ok: false, retryAfter }
  }
  fresh.push(now)
  rateBuckets.set(key, fresh)
  return { ok: true }
}

/**
 * Higher-level helpers used by /api/public/intake. Kept as thin
 * adapters over corsFor + buildCorsHeaders so we have one place that
 * decides the negotiated origin and a small set of names every public
 * route can pick from based on style preference.
 *
 * `withPublicCors` wraps a handler so:
 *   • disallowed origins get a 403 before the handler runs
 *   • the handler can return either a raw NextResponse or anything
 *     and we patch the response headers with CORS on the way out
 *
 * `jsonWithCors` is a one-liner for `NextResponse.json(payload, …)`
 * with the negotiated CORS headers attached.
 *
 * `optionsForCors` is just an alias for handleCorsPreflight so the
 * route's `OPTIONS` export reads symmetrically with `withPublicCors`.
 */
export function optionsForCors(req: NextRequest): Response {
  return handleCorsPreflight(req)
}

export function jsonWithCors(
  req: NextRequest,
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): NextResponse {
  const origin = req.headers.get("origin")
  const cors = buildCorsHeaders(origin)
  return NextResponse.json(body, {
    status,
    headers: { ...cors, ...extraHeaders },
  })
}

type Handler = (req: NextRequest) => Promise<Response> | Response

export function withPublicCors(handler: Handler): Handler {
  return async (req: NextRequest) => {
    const origin = req.headers.get("origin")
    // Server-to-server (no Origin) is allowed; only browsers send it.
    if (origin && !isAllowedOrigin(origin)) {
      return new Response(JSON.stringify({ error: "origin_not_allowed" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    }
    const res = await handler(req)
    // Patch CORS headers onto whatever the handler returned. We
    // clone the response because Response is otherwise immutable.
    const corsHeaders = buildCorsHeaders(origin)
    if (Object.keys(corsHeaders).length === 0) return res
    const newHeaders = new Headers(res.headers)
    for (const [k, v] of Object.entries(corsHeaders)) newHeaders.set(k, v)
    // Read the body once. (Public endpoints are JSON or empty so
    // this is fine; if we ever stream we'll need a different shim.)
    const body = await res.arrayBuffer()
    return new Response(body, {
      status: res.status,
      statusText: res.statusText,
      headers: newHeaders,
    })
  }
}
