/**
 * The HMAC secret used to sign OAuth `state` parameters.
 *
 * ─── WHY THIS EXISTS ─────────────────────────────────────────────────
 * Calendly, Ignition and ProConnect each sign a self-contained state
 * payload so the cross-domain redirect back to /callback can be trusted
 * without relying on a session cookie surviving the hop.
 *
 * All three borrowed SUPABASE_JWT_SECRET, on the reasoning that it was
 * "already required for auth so no new env var is needed". That was never
 * true — nothing in this codebase uses that value to verify a Supabase
 * token; it was simply a conveniently available random string. Borrowing it
 * had two costs:
 *
 *   1. Supabase has since migrated this project to JWT signing keys, and
 *      the legacy secret can no longer be rotated on its own. Anything
 *      depending on it inherited that limitation.
 *   2. It coupled an unrelated CSRF defence to a database credential, so
 *      rotating either one meant thinking about both.
 *
 * OAUTH_STATE_SECRET is ours, has no other job, and rotates with a plain
 * `openssl rand -hex 32`. Rotating it invalidates any OAuth flow started in
 * the previous 10 minutes — the user clicks Connect again.
 *
 * The fallback chain is kept so nothing breaks before the variable is set.
 * Remove it once OAUTH_STATE_SECRET exists in every environment.
 */
export function getOAuthStateSecret(): string {
  const dedicated = process.env.OAUTH_STATE_SECRET
  if (dedicated) return dedicated

  const inherited =
    process.env.SUPABASE_JWT_SECRET || process.env.PROCONNECT_CLIENT_SECRET
  if (inherited) {
    console.warn(
      "[oauth-state] OAUTH_STATE_SECRET is not set — falling back to a borrowed secret. " +
        "Set OAUTH_STATE_SECRET (openssl rand -hex 32) so OAuth state no longer depends on a database credential."
    )
    return inherited
  }
  throw new Error(
    "OAUTH_STATE_SECRET is not set and no fallback secret is available — refusing to sign OAuth state with a default."
  )
}
