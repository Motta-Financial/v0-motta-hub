import { createBrowserClient } from "@supabase/ssr"

let supabaseClient: ReturnType<typeof createBrowserClient> | null = null

export function createClient() {
  if (supabaseClient) {
    return supabaseClient
  }

  supabaseClient = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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

  return supabaseClient
}
