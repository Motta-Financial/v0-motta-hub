// Centralised CORS helper for the ALFRED public surface.
//
// `alfred.motta.cpa` is hosted as a separate origin from the Hub
// (`motta.cpa` / Vercel preview URLs) but consumes a few Hub APIs
// directly: /api/alfred/chat for streaming, /api/alfred/conversations
// for the recent-list rail, and /api/alfred/conversations/[id] for
// hydration. Browsers will block all of those without explicit
// Access-Control-Allow-Origin headers.
//
// Design notes:
//   * Origin is read from `ALFRED_PUBLIC_ORIGIN` so we can flip prod
//     vs. preview vs. nothing-allowed by changing one env var. We do
//     NOT echo arbitrary origins -- that would let any site call our
//     authenticated endpoints with a user's cookies attached.
//   * We use `Access-Control-Allow-Credentials: true` because the
//     cookie-based path needs the browser to send the Supabase session
//     cookie cross-origin. With credentials, the spec requires a
//     specific origin (no `*`), which is exactly what we set.
//   * Headers are also echoed on the streamed Response, not just on
//     the OPTIONS preflight, otherwise the browser drops the body.

const ALLOWED_HEADERS = "Authorization, Content-Type, x-alfred-conversation-id"
const ALLOWED_METHODS = "GET, POST, OPTIONS"

export function applyAlfredCors<T extends Response>(response: T, request: Request): T {
  const allowed = process.env.ALFRED_PUBLIC_ORIGIN
  const origin = request.headers.get("origin")

  // Only echo the origin when it matches the explicitly configured one.
  // No env var, or a mismatched origin, means no CORS headers and the
  // browser will block the cross-origin call -- which is the safe
  // default for an authenticated surface.
  if (!allowed || !origin || origin !== allowed) {
    // We still set Vary: Origin so any cache layers in front of us
    // don't cache a no-CORS response and serve it to the matching
    // origin later.
    response.headers.append("Vary", "Origin")
    return response
  }

  response.headers.set("Access-Control-Allow-Origin", origin)
  response.headers.set("Access-Control-Allow-Credentials", "true")
  response.headers.set("Access-Control-Allow-Headers", ALLOWED_HEADERS)
  response.headers.set("Access-Control-Allow-Methods", ALLOWED_METHODS)
  // Browsers cache successful preflights for this many seconds; reduces
  // OPTIONS chatter on every fetch from the embedded client.
  response.headers.set("Access-Control-Max-Age", "600")
  response.headers.append("Vary", "Origin")
  return response
}

/**
 * Convenience for OPTIONS preflight handlers. Returns a 204 response
 * with the CORS headers attached.
 */
export function preflightResponse(request: Request): Response {
  return applyAlfredCors(new Response(null, { status: 204 }), request)
}
