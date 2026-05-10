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
