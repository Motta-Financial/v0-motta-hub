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

  // Do not run code between createServerClient and
  // supabase.auth.getUser(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  const {
    data: { user },
  } = await supabase.auth.getUser()

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
