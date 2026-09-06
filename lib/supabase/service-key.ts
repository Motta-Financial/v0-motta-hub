/**
 * The privileged Supabase key, preferring the current-generation secret key.
 *
 * ─── WHY THIS EXISTS ─────────────────────────────────────────────────
 * Supabase has two generations of privileged key:
 *
 *   SUPABASE_SERVICE_ROLE_KEY   legacy — a JWT signed by the project's
 *                               legacy JWT secret. Cannot be rotated on
 *                               its own; the only way to invalidate it is
 *                               to disable legacy API keys entirely.
 *   SUPABASE_SECRET_KEY         current — an `sb_secret_…` key that can be
 *                               created and revoked independently, as many
 *                               times as you like.
 *
 * They are interchangeable at the call site: supabase-js accepts either
 * wherever a service-role key was previously passed.
 *
 * Preferring the secret key is what makes the legacy key disposable. While
 * any code path still reads SUPABASE_SERVICE_ROLE_KEY first, disabling
 * legacy API keys in Supabase would take the app down — so a leaked legacy
 * key could not be revoked without an outage.
 *
 * The fallback stays so nothing breaks before SUPABASE_SECRET_KEY is set in
 * every environment. Once it is, the legacy variable can be removed and
 * legacy API keys disabled in the Supabase dashboard.
 */
export function getServiceKey(): string | undefined {
  return process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
}
