/**
 * The browser-safe Supabase key, preferring the current-generation
 * publishable key.
 *
 * ─── WHY THIS EXISTS ─────────────────────────────────────────────────
 * Companion to lib/supabase/service-key.ts, for the same reason and with
 * the same shape:
 *
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY          legacy — a JWT signed by the
 *                                          project's legacy JWT secret.
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY   current — an `sb_publishable_…`
 *                                          key, rotatable on its own.
 *
 * Supabase will not let you disable legacy API keys while anything still
 * reads the anon key — and disabling them is the only way to invalidate a
 * leaked `service_role` key, because it cannot be rotated by itself. So
 * this is the last dependency standing between us and revoking a
 * credential that reaches every row in the database.
 *
 * Both are safe in a browser: they carry no privileges beyond what RLS
 * policies allow. The publishable key is the drop-in replacement.
 *
 * NOTE ON BUNDLING: `process.env.NEXT_PUBLIC_*` is substituted at build
 * time, so both names must appear literally here. Don't refactor this into
 * a dynamic lookup — the value would be undefined in the browser.
 */
export function getPublishableKey(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
}
