import { updateSession } from "@/lib/supabase/middleware"
import { type NextRequest, NextResponse } from "next/server"

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // Skip middleware entirely for static assets
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".") // Any file with extension (images, etc.)
  ) {
    return NextResponse.next()
  }

  const result = await updateSession(request)

  // If updateSession returns a plain NextResponse (env vars missing), pass through
  if (result instanceof NextResponse) {
    return result
  }

  const { supabaseResponse, supabase, user } = result

  // Enforce platform-level deactivation. A team_member can be marked inactive
  // (Alumni / deactivated) independently of their Karbon profile -- when that
  // happens we sign them out immediately, even if their session cookie is
  // still otherwise valid. We also ban the auth account separately so they
  // can't refresh, but this catches stale sessions on the next request.
  if (user) {
    const { data: tm } = await supabase
      .from("team_members")
      .select("is_active")
      .or(`auth_user_id.eq.${user.id},email.eq.${user.email ?? ""}`)
      .maybeSingle()

    // If we found a row and it's explicitly inactive, terminate the session.
    // (No row = brand new auth user that hasn't been provisioned yet -- let
    // them through so the existing onboarding flow can create their profile.)
    if (tm && tm.is_active === false) {
      await supabase.auth.signOut()
      const url = request.nextUrl.clone()
      url.pathname = "/login"
      url.searchParams.set("reason", "deactivated")
      return NextResponse.redirect(url)
    }
  }

  const isLoginPage = pathname === "/login"
  const isAuthCallback = pathname.startsWith("/auth")
  const isPublicApi = pathname.startsWith("/api/alfred")
  const isWebhook =
    pathname.startsWith("/api/webhooks") ||
    pathname.startsWith("/api/karbon/webhooks") ||
    // Calendly POSTs webhook events here; signature is verified inside
    // the route handler via the per-subscription signing key.
    pathname === "/api/calendly/webhook"
  const isCron = pathname.startsWith("/api/cron")
  // Calendly's OAuth provider sends the user back to /api/calendly/oauth/callback
  // before our app session cookie has been issued — exempt only the callback,
  // not the rest of the OAuth surface (authorize/refresh/disconnect still
  // require a logged-in team member).
  const isCalendlyOAuthCallback = pathname === "/api/calendly/oauth/callback"

  // Allow internal server-to-server calls (e.g. cron -> /api/karbon/sync -> /api/karbon/contacts)
  // These pass a shared secret so middleware doesn't block the sync chain.
  const isInternalCall =
    pathname.startsWith("/api/karbon/") &&
    process.env.CRON_SECRET &&
    request.headers.get("x-internal-secret") === process.env.CRON_SECRET

  // Allow auth callback, public API, webhooks, cron, OAuth callbacks, and
  // internal calls without auth checks
  if (
    isAuthCallback ||
    isPublicApi ||
    isWebhook ||
    isCron ||
    isCalendlyOAuthCallback ||
    isInternalCall
  ) {
    return supabaseResponse
  }

  // API routes require authentication
  const isApiRoute = pathname.startsWith("/api")
  if (isApiRoute && !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Redirect unauthenticated users to login (except if already on login)
  if (!user && !isLoginPage) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    return NextResponse.redirect(url)
  }

  // Redirect authenticated users away from login page to home
  if (user && isLoginPage) {
    const url = request.nextUrl.clone()
    url.pathname = "/"
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|json|js|css)$).*)"],
}
