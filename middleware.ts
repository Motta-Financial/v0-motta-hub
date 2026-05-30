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
  //
  // ALFRED note: The ALFRED service-account team_member row
  // (lib/alfred/service-account.ts) is intentionally NOT special-cased here.
  // It is treated like any other authenticated user: subject to the same
  // is_active check, the same allowlist, and the same redirect rules. We
  // deliberately do NOT auto-elevate ALFRED's session -- any privileged
  // automation that runs as ALFRED must do so via service-role calls in a
  // server action / API route, not via this middleware.
  if (user) {
    // Two-step lookup so we never feed user-controlled values into a
    // PostgREST `.or()` filter string. The previous implementation
    // built `or=(auth_user_id.eq.${id},email.eq.${email})` by string
    // interpolation -- emails legally contain `,` and `)` inside
    // quoted local parts (RFC 5321), and any such value would break
    // PostgREST's filter parser and return 4xx, silently kicking the
    // user back to /login. Each query below is a single `.eq()` so
    // the value is URL-encoded as a whole token.
    let tm: { is_active: boolean | null } | null = null
    const byAuthId = await supabase
      .from("team_members")
      .select("is_active")
      .eq("auth_user_id", user.id)
      .maybeSingle()
    if (byAuthId.data) {
      tm = byAuthId.data
    } else if (user.email) {
      const byEmail = await supabase
        .from("team_members")
        .select("is_active")
        .eq("email", user.email)
        .maybeSingle()
      tm = byEmail.data
    }

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
  // Anonymous landing page served at motta.cpa. We deliberately do not
  // redirect signed-in users away from /welcome — a logged-in team
  // member can still want to view the public marketing surface (e.g.
  // to share a screenshot with a prospect). The "Team log in" CTA on
  // the page links to /login, which IS gated below.
  const isWelcomePage = pathname === "/welcome"
  const isAuthCallback = pathname.startsWith("/auth")
  // Public auth API: /api/auth/forgot-password is the entrypoint for the
  // self-service password reset flow and must be reachable without a session.
  const isPublicAuthApi = pathname.startsWith("/api/auth/forgot-password")
  // /api/alfred/health is a deliberately unauthenticated status probe so
  // alfred.motta.cpa (and any external monitor) can verify the Hub is
  // reachable, the Supabase env is configured, and the ALFRED service
  // account row is present BEFORE attempting any authenticated calls.
  // The handler itself is careful not to leak any user data.
  const isAlfredHealthCheck = pathname === "/api/alfred/health"
  // ALFRED public-API surface. Previously the entire `/api/alfred/*`
  // subtree was exempt, which exposed 46+ Supabase tables to anyone with
  // the URL. The data REST endpoints (`/data`, `/schema`, `/search`,
  // `/stats`) go through the normal middleware path AND are guarded
  // inside their own handlers via `requireAlfredAuth()`
  // (lib/alfred/auth-guard.ts), which accepts either a Supabase session
  // OR an `x-alfred-secret` header.
  //
  // The cross-origin surface used by alfred.motta.cpa
  // (`/api/alfred/chat`, `/api/alfred/conversations`,
  // `/api/alfred/conversations/[id]`) is handled separately below by
  // `isAlfredAuthedSurface` -- the route handlers enforce identity via
  // cookie OR `Authorization: Bearer`, but middleware still has to let
  // the request reach the handler in the Bearer case (no cookie =>
  // `user` is null, which would otherwise 401 below).
  const isPublicApi =
    isPublicAuthApi ||
    // The public-website surface. motta.cpa (and the website team's
    // Vercel previews) POST contact + intake submissions here. CORS
    // origin allowlist + honeypot + IP rate-limit live INSIDE each
    // route, not in middleware — middleware just has to let the
    // anonymous request reach the handler.
    pathname.startsWith("/api/public/")
  // Public iframe-able pages used by the marketing site at motta.cpa.
  // No auth, no Hub chrome — see app/embed/layout.tsx and the
  // frame-ancestors CSP in next.config.mjs.
  const isPublicEmbed = pathname.startsWith("/embed/")
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

  // ProConnect Tax (Intuit) POSTs real-time webhook notifications for
  // Client, TaxReturn, and TaxReturnWorkStatus events. The route handler
  // will verify payloads once Intuit documents their signing mechanism.
  const isProConnectWebhook = pathname === "/api/proconnect/webhooks"

  // ProConnect sync endpoint - uses CRON_SECRET Bearer auth in the handler
  const isProConnectSync = pathname === "/api/proconnect/sync"

  // Zoom recordings backfill - uses CRON_SECRET Bearer auth in the handler
  // (or a logged-in admin). Middleware must let the request through so the
  // route's own auth logic can run.
  const isZoomRecordingsBackfill = pathname === "/api/zoom/recordings/backfill"

  // Hub Meetings sync - CRON_SECRET Bearer auth or logged-in admin, checked
  // in the handler. (GET /api/meetings stays behind normal session auth.)
  const isHubMeetingsSync = pathname === "/api/meetings/sync"

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

  // Allow ALFRED server-to-server data calls. The route handler
  // (requireAlfredAuth) re-checks the secret in constant logic, but
  // middleware has to let the request through first or it would 401
  // before our handler ever runs. We deliberately do NOT compare to env
  // here -- handing that off to the route handler means a single source
  // of truth for the secret check, and ensures a misconfigured server
  // returns a clear 503 (from the handler) instead of the generic 401
  // the middleware emits.
  const isAlfredDataCall =
    (pathname === "/api/alfred/data" ||
      pathname === "/api/alfred/schema" ||
      pathname === "/api/alfred/search" ||
      pathname === "/api/alfred/stats") &&
    request.headers.get("x-alfred-secret") !== null

  // Cross-origin ALFRED surface (chat + conversations). These endpoints
  // serve requests from alfred.motta.cpa as well as the in-Hub UI. The
  // route handlers enforce identity themselves via cookie OR
  // Authorization: Bearer (lib/alfred/resolve-user.ts), so middleware's
  // job is simply to not block the Bearer case (no cookie => no `user`
  // => the API 401 below would fire) and to let CORS preflights pass.
  const isAlfredAuthedSurface =
    pathname === "/api/alfred/chat" ||
    pathname === "/api/alfred/conversations" ||
    pathname.startsWith("/api/alfred/conversations/") ||
    pathname === "/api/alfred/whoami"
  // Preflight: browsers strip credentials from OPTIONS, so we cannot
  // require auth here. Always let it through to the handler's
  // dedicated OPTIONS export, which returns the proper CORS headers.
  const isAlfredCorsPreflight =
    isAlfredAuthedSurface && request.method === "OPTIONS"
  // Bearer case: route validates the token itself. Cookie case is
  // handled by the normal `user`-based flow further down.
  const isAlfredBearerCall =
    isAlfredAuthedSurface &&
    (request.headers.get("authorization") ?? request.headers.get("Authorization") ?? "")
      .toLowerCase()
      .startsWith("bearer ")

  // Allow auth callback, public API, webhooks, cron, OAuth callbacks, and
  // internal calls without auth checks
  if (
    isAuthCallback ||
    isPublicApi ||
    isWebhook ||
    isProConnectWebhook ||
    isProConnectSync ||
    isZoomRecordingsBackfill ||
    isHubMeetingsSync ||
    isCron ||
    isCalendlyOAuthCallback ||
    isInternalCall ||
    isAlfredDataCall ||
    isAlfredHealthCheck ||
    isAlfredCorsPreflight ||
    isAlfredBearerCall ||
    isZoomEmbed ||
    isLegalPage ||
    isDocsPage ||
    isPublicEmbed ||
    isWelcomePage
  ) {
    return supabaseResponse
  }

  // API routes require authentication
  const isApiRoute = pathname.startsWith("/api")
  if (isApiRoute && !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Redirect unauthenticated users to the public landing page (except
  // if they've explicitly navigated to /login, which we let through so
  // the auth screen can render).
  if (!user && !isLoginPage) {
    const url = request.nextUrl.clone()
    url.pathname = "/welcome"
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
