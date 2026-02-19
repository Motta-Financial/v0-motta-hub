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
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // The "setAll" method was called from a Server Component.
        }
      },
    },
  })
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
