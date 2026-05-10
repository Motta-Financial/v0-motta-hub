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
  // Public auth API: /api/auth/forgot-password is the entrypoint for the
  // self-service password reset flow and must be reachable without a session.
  const isPublicAuthApi = pathname.startsWith("/api/auth/forgot-password")
  const isPublicApi = pathname.startsWith("/api/alfred") || isPublicAuthApi
  const isWebhook =
    pathname.startsWith("/api/webhooks") ||
    pathname.startsWith("/api/karbon/webhooks") ||
    // Calendly POSTs webhook events here; signature is verified inside
    // the route handler via the per-subscription signing key.
    pathname === "/api/calendly/webhook" ||
    // Jotform POSTs new intake-form submissions here. Free-tier Jotform
    // doesn't sign payloads, so the route handler instead requires a
    // per-form `?token=` query param that matches the row's
    // `webhook_secret` in `jotform_forms`. Without this allow-list entry
    // the auth middleware would 401 every Jotform delivery and the
    // intake pipeline would silently fail.
    pathname === "/api/jotform/webhook" ||
    // Zoom POSTs Marketplace event subscriptions here (recording.completed,
    // meeting.ended, app.deauthorized, etc.). Zoom's URL-validation
    // handshake also hits this endpoint, so it must be reachable
    // without a Hub session. The route handler verifies the
    // x-zm-signature HMAC against ZOOM_WEBHOOK_SECRET_TOKEN.
    pathname === "/api/zoom/webhook" ||
    // Zoom OAuth callback (and authorize). When a user installs the
    // Hub from Zoom's Marketplace "Add to Zoom" button, the redirect
    // back to /api/zoom/oauth/callback may not carry a Hub session
    // cookie. Auth0/Supabase auth checks would 500 the response
    // before our handler runs. Allow the whole oauth subtree;
    // /authorize is harmless without a session (it just redirects
    // to Zoom) and /callback resolves the Hub user via cookie OR
    // state OR returns a friendly error.
    pathname.startsWith("/api/zoom/oauth/")

  // The Zoom App "Surface" (Marketplace > Features > Surface) iframes
  // /zoom/embed inside the Zoom desktop / web client. The Hub user is
  // not necessarily logged in to motta.cpa at that moment — the page
  // authenticates via the Zoom Apps SDK's own session context once
  // it loads. Forcing the Auth0 redirect here would break the iframe
  // because Auth0 sets X-Frame-Options: DENY on /login. Skipping the
  // session check on this path lets Zoom render the page; the page
  // itself reads zoomSdk.getAppContext() to identify the user.
  const isZoomEmbed = pathname.startsWith("/zoom/embed")
  // Legal pages (Terms of Service, etc.) must be publicly accessible so
  // Zoom's Marketplace review bot can fetch them without authentication.
  const isLegalPage = pathname.startsWith("/legal")
  // Documentation pages (e.g. /docs/zoom-integration) are linked from the
  // Zoom App Marketplace listing as the "Documentation URL" and must be
  // reachable by Zoom's review team without a Hub login.
  const isDocsPage = pathname.startsWith("/docs")
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
    isInternalCall ||
    isZoomEmbed ||
    isLegalPage ||
    isDocsPage
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
