import { createServerClient } from "@supabase/ssr"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { cookies } from "next/headers"

/**
 * Create a Supabase client that uses the current user's session (via cookies).
 * Use in Server Components and API routes that need per-user auth context.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, withCookieAttributes(options)),
          )
        } catch {
          // The "setAll" method was called from a Server Component.
        }
      },
    },
    auth: {
      // CRITICAL: This is THE fix for the per-IP "Too many sign-in
      // attempts" cascade.
      //
      // Symptom (see Supabase auth logs):
      //   60+ POST /token grant_type=refresh_token requests in a
      //   ~4-second window, all from a single user's session, half
      //   from the office NAT IP (browser) and half from Vercel's
      //   IP (server). One returns 400 "Refresh Token Not Found",
      //   the rest cascade to 429 over_request_rate_limit. The
      //   per-IP /token bucket fills, and the same bucket gates
      //   sign-in — so legitimate logins fail with "Request rate
      //   limit reached".
      //
      // Root cause:
      //   Each call to this `createClient()` (one per API route
      //   handler, server component, server action) builds a fresh
      //   @supabase/ssr SSR client. Its default config has
      //   `autoRefreshToken: true`, so as soon as anything calls
      //   `auth.getSession()` / `auth.getUser()` with an
      //   access-token that's close to expiry, the client fires a
      //   POST /token. With 5–10 concurrent API calls per page
      //   load (SWR polls, UserContext fetch, parallel data
      //   loaders), they each independently decide a refresh is
      //   needed and each fire one. Supabase refresh tokens are
      //   single-use by default — the first request rotates the
      //   token, every other in-flight request now holds the
      //   already-rotated old token and the next time anyone tries
      //   to refresh it returns 400 "Refresh Token Not Found".
      //   Browser tabs holding stale tokens then retry on their
      //   internal timer, multiplying the storm.
      //
      // Why this fix works:
      //   The Next.js `middleware.ts` is the SINGLE source of
      //   refresh truth on the server. It runs once per top-level
      //   request, calls `getSession()` exactly once, and on
      //   success writes the rotated cookies to the response. By
      //   the time any API route handler / server component runs,
      //   the request already carries the freshest cookies. All
      //   those downstream handlers need to do is read the
      //   access-token JWT from the cookie and verify its
      //   signature locally — they should NEVER fire their own
      //   refresh.
      //
      // What we trade away:
      //   Nothing functional. If a token is genuinely expired by
      //   the time an API handler runs, `getSession()` returns
      //   null and the handler responds 401, which is the correct
      //   behavior. The browser sees 401, the next page nav goes
      //   through middleware, middleware refreshes, the user is
      //   transparently back online.
      //
      // Why not also turn off persistSession:
      //   @supabase/ssr's cookie adapter IS the "persistence" --
      //   sessions live in the cookie store this client is wired
      //   to. Leaving persistSession at its default (true) is
      //   correct; it just means "use the storage adapter we gave
      //   you". The bug was specifically the in-process refresh
      //   timer, which `autoRefreshToken: false` disables.
      autoRefreshToken: false,
    },
  })
}

/**
 * Augment the per-cookie options @supabase/ssr hands us with the
 * cross-subdomain attributes we need so that the same Supabase session
 * cookie issued by the Hub at e.g. `motta.cpa` is also visible to the
 * ALFRED frontend at `alfred.motta.cpa`.
 *
 * - `domain` is set ONLY when SUPABASE_COOKIE_DOMAIN is defined. In
 *   local dev the env var is unset, so the cookie stays scoped to the
 *   exact host (typically `localhost`) and SameSite remains effective.
 * - `sameSite: "lax"` keeps the cookie attached to top-level
 *   navigations and same-site fetches. We deliberately do NOT use
 *   "none" -- our cross-domain auth path uses a Bearer token, not the
 *   cookie, so SameSite=None would only widen attack surface.
 * - `secure: true` is always on. Modern browsers treat localhost as a
 *   secure context, so this still works for local dev.
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

/**
 * Create a Supabase admin client using the service role key.
 * Bypasses RLS -- use for server-to-server operations (cron, sync, webhooks).
 *
 * IMPORTANT: Always call this inside your request handler, never at module level.
 * Module-level clients share a single instance across all requests and can cause
 * stale-connection and auth issues with Vercel Fluid Compute.
 */
export function createAdminClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  }

  return createSupabaseClient(url, key)
}

/**
 * Non-throwing variant of createAdminClient.
 * Returns null when env vars are missing instead of throwing.
 * Used by Karbon sync routes where Supabase may not be configured.
 */
export function tryCreateAdminClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    return null
  }

  return createSupabaseClient(url, key)
}
