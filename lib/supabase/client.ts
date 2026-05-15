import { createBrowserClient } from "@supabase/ssr"

let supabaseClient: ReturnType<typeof createBrowserClient> | null = null

export function createClient() {
  if (supabaseClient) {
    return supabaseClient
  }

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

  supabaseClient = createBrowserClient(
    url,
    anonKey,
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
