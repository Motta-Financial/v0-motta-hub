import type { SupabaseClient, User } from "@supabase/supabase-js"

/**
 * Resolve the authenticated user for an API-route / server-component
 * request WITHOUT making a network call to Supabase GoTrue.
 *
 * Why this exists
 * ---------------
 * `supabase.auth.getUser()` performs a round-trip to GoTrue's
 * `/auth/v1/user` endpoint on EVERY call so it can re-validate the
 * access token against the auth server. That's exactly what you want
 * for genuinely sensitive surfaces (admin tooling, password changes,
 * service-role escalation) but it's massive overkill for the dozens of
 * read-only "show me my Calendly events / my profile / my training
 * videos" routes the Hub UI hits on every page load.
 *
 * Concretely, a single authenticated dashboard render fans out to
 * 5–10 parallel API calls. With each handler calling `getUser()`,
 * that's 5–10 GoTrue requests per page nav, multiplied by every team
 * member on the same office NAT IP. Supabase Cloud's per-IP auth
 * request limiter is ~30 requests per 5 minutes — two team members
 * actively using the app are enough to trip it and lock everyone out
 * of `signInWithPassword` with "Request rate limit reached".
 *
 * What this does instead
 * ----------------------
 * Calls `supabase.auth.getSession()`, which (when invoked via the
 * `@supabase/ssr` server client) reads the access-token cookie and
 * verifies its JWT signature LOCALLY using the project's JWT secret.
 * No network call. The cryptographic check is the same one GoTrue
 * itself runs, so the resulting `user.id` / `user.email` claims are
 * trustworthy for the duration of this request.
 *
 * Trade-offs you accept by using this helper
 * ------------------------------------------
 * - If the user's session was revoked server-side (admin ban, password
 *   change elsewhere) AFTER their access token was minted but BEFORE
 *   the token's 1-hour expiry, this helper will still see them as
 *   authenticated. That window is bounded by the access-token TTL.
 * - Mitigations already in place:
 *     1. The middleware (`lib/supabase/middleware.ts`) enforces the
 *        `team_members.is_active` flag on every request — a single
 *        Postgres call, not an auth call — so deactivated users are
 *        booted on their next nav regardless of token freshness.
 *     2. Genuinely sensitive routes (admin actions, password changes,
 *        Zoom/Alfred OAuth callbacks) still call `getUser()`
 *        explicitly. See `lib/auth/require-admin.ts` and
 *        `lib/alfred/auth-guard.ts`.
 *
 * Shape mirrors `auth.getUser()` so callers can swap in place:
 *
 *   // before
 *   const { data: { user }, error } = await supabase.auth.getUser()
 *
 *   // after
 *   const { data: { user }, error } = await getAuthenticatedUser(supabase)
 */
export async function getAuthenticatedUser(
  supabase: SupabaseClient,
): Promise<{ data: { user: User | null }; error: { message: string } | null }> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession()

  if (error) {
    return { data: { user: null }, error: { message: error.message } }
  }

  return { data: { user: session?.user ?? null }, error: null }
}
