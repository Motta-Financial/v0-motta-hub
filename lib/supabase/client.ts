import { createBrowserClient } from "@supabase/ssr"

// NOTE: intentionally not cached as a singleton.
// Caching caused stale session state to persist across sign-in/sign-out
// cycles (especially with autoRefreshToken: false), so the team_members
// lookup after signInWithPassword ran with a dead cookie and returned null,
// showing the misleading "Access denied / not a team member" error.
// Each call creates a fresh client that reads the current cookie state.

/**
 * Cookie attributes for the browser-issued session cookie.
 *
 * Mirrors `withCookieAttributes()` in lib/supabase/server.ts so both sides
 * write an identically-scoped cookie — if they disagree, the browser and the
 * server each set their own variant under the same name and the resulting
 * precedence is effectively undefined.
 *
 * `domain` is attached ONLY when the env var is present. Omitting the key
 * entirely (rather than passing `domain: undefined`) keeps local dev on a
 * host-only `localhost` cookie, which is what we want there, and avoids
 * relying on how @supabase/ssr serialises an undefined attribute.
 */
function buildBrowserCookieOptions(): {
  domain?: string
  path: string
  sameSite: "lax"
  secure: boolean
} {
  const options = {
    path: "/",
    // Deliberately "lax", not "none" — the cross-domain ALFRED path
    // authenticates with a Bearer token, not this cookie, so "none" would
    // only widen attack surface. Matches the server-side choice.
    sameSite: "lax" as const,
    // Always on. Browsers treat localhost as a secure context, so local dev
    // is unaffected.
    secure: true,
  }
  const domain = process.env.NEXT_PUBLIC_SUPABASE_COOKIE_DOMAIN
  return domain ? { ...options, domain } : options
}

export function createClient() {
  // Surface a clear, actionable error when the public Supabase env vars
  // aren't inlined into the client bundle. This happens when the dev
  // server is built without the NEXT_PUBLIC_* vars in process.env (the
  // bundle then ships `undefined` for both args and @supabase/ssr's
  // generic "URL and API key are required" message crashes the whole
  // React tree on every route). We re-throw with the same shape so the
  // call sites that already have try/catch on createClient() (login,
  // forgot-password handlers) still work, but the message now tells
  // the operator exactly what to do.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error(
      "Supabase env vars are missing from the client bundle. " +
        "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be " +
        "present in process.env when `next build` or `next dev` runs. In the " +
        "v0 sandbox, ensure `.env.local` symlinks to /vercel/share/.env.project " +
        "so Next.js picks them up at build time.",
    )
  }

  return createBrowserClient(
    url,
    anonKey,
    {
      // CRITICAL: scope the session cookie to the parent domain so
      // alfred.motta.cpa can see it.
      //
      // Without this, `createBrowserClient` writes a HOST-ONLY cookie
      // (Domain column in DevTools reads `hub.motta.cpa`, not
      // `.motta.cpa`). Browsers never send a host-only cookie to a
      // sibling subdomain, so ALFRED could never see a Hub session and
      // cross-subdomain SSO was dead on arrival.
      //
      // Why this was easy to miss: only the BROWSER path was wrong.
      // lib/supabase/server.ts and lib/supabase/middleware.ts both already
      // apply the domain via their `withCookieAttributes()` helper, so the
      // magic-link / PKCE flow through app/auth/callback/route.ts produced a
      // correctly-scoped `.motta.cpa` cookie. But password sign-in runs
      // client-side (app/login/page.tsx -> signInWithPassword), and that path
      // wrote the host-only cookie. Result: SSO appeared to work for some
      // users and not others depending on how they signed in.
      //
      // The domain must come from a NEXT_PUBLIC_ var: the server-side
      // `SUPABASE_COOKIE_DOMAIN` is not inlined into the client bundle and
      // reads as `undefined` in the browser.
      cookieOptions: buildBrowserCookieOptions(),
      auth: {
        // CRITICAL: Disable background token refresh in the browser.
        //
        // The GoTrue client's default behavior is to automatically
        // POST /token grant_type=refresh_token every ~50 minutes
        // (when the access token is near expiry). With multiple
        // users behind the same office NAT IP, each with multiple
        // tabs open, these background refreshes alone can saturate
        // Supabase's per-IP rate limit (~30 requests / 5 min on
        // Cloud). The /token bucket is SHARED with sign-in, so once
        // it fills, legitimate signInWithPassword calls start
        // failing with "Request rate limit reached".
        //
        // Instead we handle token freshness explicitly:
        //   1. The Next.js middleware runs on every navigation and
        //      calls getSession() — if the token needs refreshing,
        //      middleware does it once and writes fresh cookies.
        //   2. For long-lived tabs that don't navigate, we rely on
        //      the access token's ~1 hour validity. If a fetch 401s,
        //      the user clicks something, middleware refreshes, done.
        //
        // This matches the server-side fix in lib/supabase/server.ts.
        autoRefreshToken: false,
      },
    },
  )
}
