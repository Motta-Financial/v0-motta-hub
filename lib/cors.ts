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
