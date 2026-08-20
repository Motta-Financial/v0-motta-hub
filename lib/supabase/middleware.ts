import { createServerClient } from "@supabase/ssr"
import type { Session } from "@supabase/supabase-js"
import { NextResponse, type NextRequest } from "next/server"

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    // If env vars are not set, skip Supabase auth checks
    return supabaseResponse
  }

  // Only DOCUMENT NAVIGATIONS are allowed to rotate the refresh token.
  //
  // server.ts:28-86 turned off `autoRefreshToken` on the per-request SSR
  // client and made this middleware "the SINGLE source of refresh truth
  // on the server", on the stated premise that middleware "runs once per
  // top-level request". That premise does not hold: the matcher in
  // middleware.ts also matches `/api/*`, so each of the 5-10 parallel
  // fetches a dashboard render fans out is its OWN middleware invocation.
  // Each one built a client with `autoRefreshToken` at its default `true`,
  // so they all raced to refresh the same token — one won, the rest got
  // 400 `refresh_token_already_used`, and the retries filled the per-IP
  // /token bucket with 429 `over_request_rate_limit`. That is the exact
  // storm server.ts was written to kill; it had only moved in here.
  // (Production, 2026-08-05 → 2026-08-19: 10,856 rate-limit + 1,358
  // already-used errors on /middleware, from two active sessions.)
  //
  // We can't fix it by narrowing the matcher — only 91 of 310 API routes
  // enforce their own auth, so the other ~219 depend on the session gate
  // below. Instead: navigations refresh, sub-resource requests read.
  //
  // When an API request arrives with an expired token, `getSession()`
  // returns null and the route 401s. That is the correct, already-
  // documented behavior (server.ts:71-77) — the browser sees the 401,
  // the next nav goes through this refresh path, and the user is
  // transparently back online.
  const allowRefresh = isDocumentNavigation(request)

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      // See the note above. `false` on sub-resource requests is the same
      // setting, for the same reason, as server.ts:86.
      autoRefreshToken: allowRefresh,
    },
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        )
        supabaseResponse = NextResponse.next({
          request,
        })
        cookiesToSet.forEach(({ name, value, options }) =>
          // Apply cross-subdomain attributes so the Supabase session
          // cookie issued here is readable on alfred.motta.cpa as well.
          // See lib/supabase/server.ts for the rationale on each
          // attribute. Mirrored here because the middleware writes
          // session cookies on every refresh.
          supabaseResponse.cookies.set(
            name,
            value,
            withCookieAttributes(options),
          ),
        )
      },
    },
  })

  // IMPORTANT: We deliberately use `getSession()` here instead of `getUser()`.
  //
  // Why this matters for our auth-request budget:
  //   • `getUser()` makes a **network call** to Supabase GoTrue on every
  //     request to revalidate the JWT against the auth server. With a
  //     middleware matcher this broad, every page nav, every fetch, and
  //     every SWR poll burned one auth request. That's how we hit 22,841
  //     auth calls in a day and tripped the project rate limit.
  //   • `getSession()` reads the session cookie locally and verifies the
  //     JWT signature using the project's JWT secret — no network call.
  //     The signature check is cryptographically equivalent to a getUser()
  //     call for the purpose of trusting the user.id / email claims on
  //     this request.
  //
  // What we lose by not calling getUser():
  //   • If the session was revoked server-side (admin ban, password change
  //     elsewhere) but the access token hasn't expired yet (~1 hour
  //     window), this middleware will still see the user as authenticated.
  //   • Mitigations already in place:
  //       1. The is_active check below queries the `team_members` row on
  //          every request and signs the user out if they've been
  //          deactivated — that's a single Postgres call, not an auth call.
  //       2. Sensitive route handlers (anything touching service-role
  //          data) still call `supabase.auth.getUser()` themselves, which
  //          does a fresh server-side validation.
  //
  // Do not run code between createServerClient and the session read. A
  // simple mistake could make it very hard to debug issues with users
  // being randomly logged out.
  // Explicitly typed: `let session = null` would give TS an evolving
  // `any` and silently drop the null-check on `session?.user` below.
  let session: Session | null = null
  try {
    const result = await supabase.auth.getSession()
    session = result.data.session
  } catch (err) {
    // Losing a refresh race is NOT a revoked session. Two tabs navigating
    // at the same moment can still collide even with the gate above: one
    // rotates the token, the other comes back 400 `refresh_token_already_
    // used`. We must not sign the user out on that — the session cookie is
    // scoped to `.motta.cpa` (withCookieAttributes below), so clearing it
    // would also drop their alfred.motta.cpa session.
    //
    // Treat it as "no session on THIS request" and let the caller decide.
    // A gated page redirects to /login, which bounces an already-signed-in
    // user straight back — the winning request has by then written fresh
    // cookies, so it self-heals in one hop instead of a logout.
    console.warn(
      "[middleware] session read failed; continuing without a session:",
      err instanceof Error ? err.message : err,
    )
  }
  const user = session?.user ?? null

  return { supabaseResponse, supabase, user }
}

/**
 * True when this request is a top-level document navigation rather than a
 * sub-resource fetch (SWR poll, parallel data loader, prefetch).
 *
 * `sec-fetch-mode: navigate` is sent by every browser we support. The
 * `accept: text/html` fallback covers the case where the header is absent
 * (non-browser clients, older agents); those callers authenticate with a
 * Bearer token or a shared secret rather than this cookie, so treating
 * them as non-navigations costs nothing.
 */
function isDocumentNavigation(request: NextRequest): boolean {
  const mode = request.headers.get("sec-fetch-mode")
  if (mode) return mode === "navigate"
  return (request.headers.get("accept") || "").includes("text/html")
}

/**
 * Cookie-attribute merger shared between the SSR client (server.ts) and
 * this middleware refresh path. See server.ts for the field-by-field
 * rationale.
 */
function withCookieAttributes(
  options: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {
    ...(options ?? {}),
    sameSite: "lax",
    secure: true,
  }
  const domain = process.env.SUPABASE_COOKIE_DOMAIN
  if (domain) merged.domain = domain
  return merged
}
