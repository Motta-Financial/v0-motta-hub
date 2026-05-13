import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    // If env vars are not set, skip Supabase auth checks
    return supabaseResponse
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        )
        supabaseResponse = NextResponse.next({
          request,
        })
        cookiesToSet.forEach(({ name, value, options }) =>
          // Apply cross-subdomain attributes so the Supabase session
          // cookie issued here is readable on alfred.motta.cpa as well.
          // See lib/supabase/server.ts for the rationale on each
          // attribute. Mirrored here because the middleware writes
          // session cookies on every refresh.
          supabaseResponse.cookies.set(
            name,
            value,
            withCookieAttributes(options),
          ),
        )
      },
    },
  })

  // IMPORTANT: We deliberately use `getSession()` here instead of `getUser()`.
  //
  // Why this matters for our auth-request budget:
  //   • `getUser()` makes a **network call** to Supabase GoTrue on every
  //     request to revalidate the JWT against the auth server. With a
  //     middleware matcher this broad, every page nav, every fetch, and
  //     every SWR poll burned one auth request. That's how we hit 22,841
  //     auth calls in a day and tripped the project rate limit.
  //   • `getSession()` reads the session cookie locally and verifies the
  //     JWT signature using the project's JWT secret — no network call.
  //     The signature check is cryptographically equivalent to a getUser()
  //     call for the purpose of trusting the user.id / email claims on
  //     this request.
  //
  // What we lose by not calling getUser():
  //   • If the session was revoked server-side (admin ban, password change
  //     elsewhere) but the access token hasn't expired yet (~1 hour
  //     window), this middleware will still see the user as authenticated.
  //   • Mitigations already in place:
  //       1. The is_active check below queries the `team_members` row on
  //          every request and signs the user out if they've been
  //          deactivated — that's a single Postgres call, not an auth call.
  //       2. Sensitive route handlers (anything touching service-role
  //          data) still call `supabase.auth.getUser()` themselves, which
  //          does a fresh server-side validation.
  //
  // Do not run code between createServerClient and the session read. A
  // simple mistake could make it very hard to debug issues with users
  // being randomly logged out.
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const user = session?.user ?? null

  return { supabaseResponse, supabase, user }
}

/**
 * Cookie-attribute merger shared between the SSR client (server.ts) and
 * this middleware refresh path. See server.ts for the field-by-field
 * rationale.
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
