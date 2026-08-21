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

  // Whether the current session belongs to a team_members row (staff),
  // regardless of active/inactive status. Populated below when `user` is
  // set, and consumed by the generic `/api/*` staff gate further down --
  // that gate must reject portal clients (who ARE real, authenticated
  // Supabase users, just not staff) from ever reaching internal APIs like
  // /api/clients/[id] that only check "is there a session".
  let hasStaffRow = false

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
    hasStaffRow = tm !== null

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

  // The client portal has its own login screen. Let it through without a Hub
  // session so clients can authenticate independently of the internal /login.
  const isPortalLoginPage = pathname === "/client-portal/login"

  // The portal route layout (app/client-portal/layout.tsx) is a Server
  // Component that does its own portal_users auth check and redirects to
  // /client-portal/login on failure. Middleware only needs to ensure the
  // portal pages are NOT blocked by the Hub-only redirects below (e.g. the
  // "no session → /welcome" rule would catch unauthenticated clients hitting
  // any portal page if we didn't exempt them here). We let the request through;
  // the layout's own redirect handles gate-keeping.
  const isPortalPage =
    pathname.startsWith("/client-portal") && !isPortalLoginPage

  // Portal API routes are guarded by requirePortalAuth() inside each handler.
  // Middleware must let them reach the handler (same reason as Alfred bearer calls).
  const isPortalApi = pathname.startsWith("/api/client-portal/")

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
  // /api/auth/user is UserProvider's own "am I signed in?" check -- its
  // handler already returns 200 with { user: null, teamMember: null } for
  // every failure case (no session, no staff row, etc.) by design, so the
  // client can gracefully render the signed-out UI. Without this exemption,
  // the blanket API 401 gate below fired first for EVERY signed-out or
  // non-staff visitor, so the route's own graceful fallback never ran --
  // the client saw a raw 401 instead of the intended { user: null } shape.
  const isPublicAuthApi =
    pathname.startsWith("/api/auth/forgot-password") || pathname === "/api/auth/user"
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
    // Account-wide Server-to-Server app delivers events here, verified
    // against ZOOM_S2S_WEBHOOK_SECRET_TOKEN. Same handshake + signature
    // requirements as the user-OAuth webhook above, so it likewise must
    // be reachable without a Hub session.
    pathname === "/api/zoom/s2s-webhook" ||
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
  // verifies each payload's HMAC-SHA256 `intuit-signature` against
  // PROCONNECT_WEBHOOK_VERIFIER_TOKEN.
  const isProConnectWebhook = pathname === "/api/proconnect/webhooks"

  // ProConnect sync endpoint - uses CRON_SECRET Bearer auth in the handler
  const isProConnectSync = pathname === "/api/proconnect/sync"

  // ProConnect force-refresh endpoint - uses CRON_SECRET Bearer auth OR a
  // leadership session, checked in the handler (see route.ts docblock: this
  // exists so a cron job / local script can refresh the token without
  // running a full sync). Without this exemption, middleware's session gate
  // 401s the request before the handler's own CRON_SECRET check ever runs,
  // silently breaking any non-browser caller.
  const isProConnectOAuthRefresh = pathname === "/api/proconnect/oauth/refresh"

  // Zoom recordings backfill - uses CRON_SECRET Bearer auth in the handler
  // (or a logged-in admin). Middleware must let the request through so the
  // route's own auth logic can run.
  const isZoomRecordingsBackfill = pathname === "/api/zoom/recordings/backfill"

  // Zoom account-wide S2S sync - CRON_SECRET Bearer auth or logged-in admin,
  // checked in the handler. Pulls recordings for ALL account users.
  const isZoomAccountSync = pathname === "/api/zoom/recordings/sync-account"

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

  // Intuit sends the user back to /api/proconnect/oauth/callback after consent
  // on appcenter.intuit.com — that cross-domain redirect won't carry our Hub
  // session cookie, so exempt ONLY the callback. Identity/CSRF is enforced
  // inside the handler via the HMAC-signed `state`. /connect, /disconnect, and
  // /launch are deliberately NOT exempt — they require a logged-in admin.
  const isProconnectOAuthCallback = pathname === "/api/proconnect/oauth/callback"

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

  // Allow auth callback, public API, webhooks, cron, OAuth callbacks,
  // internal calls, and the client portal (which does its own auth) without
  // the Hub-session auth checks that follow.
  if (
    isAuthCallback ||
    isPublicApi ||
    isWebhook ||
    isProConnectWebhook ||
    isProConnectSync ||
    isProConnectOAuthRefresh ||
    isZoomRecordingsBackfill ||
    isZoomAccountSync ||
    isHubMeetingsSync ||
    isCron ||
    isCalendlyOAuthCallback ||
    isProconnectOAuthCallback ||
    isInternalCall ||
    isAlfredDataCall ||
    isAlfredHealthCheck ||
    isAlfredCorsPreflight ||
    isAlfredBearerCall ||
    isZoomEmbed ||
    isLegalPage ||
    isDocsPage ||
    isPublicEmbed ||
    isWelcomePage ||
    isPortalLoginPage ||
    isPortalPage ||
    isPortalApi
  ) {
    return supabaseResponse
  }

  // API routes require authentication AND a staff (team_members) identity.
  // Every carve-out above already exempted the paths that intentionally
  // serve non-staff callers (portal clients, public forms, webhooks, cron,
  // ALFRED bearer/secret calls, OAuth callbacks). Anything that reaches this
  // point is an internal staff API, so a portal client's session -- a real,
  // authenticated Supabase user, just not a team_members row -- must be
  // rejected here, not just an anonymous request. Without this, any signed-in
  // portal client could call e.g. /api/clients/[id] directly, since that
  // handler trusts middleware and does no additional role check itself.
  const isApiRoute = pathname.startsWith("/api")
  if (isApiRoute && (!user || !hasStaffRow)) {
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

  // Redirect authenticated users away from login page. Honor a safe
  // ?redirect= param pointing at an https *.motta.cpa URL — alfred-chat
  // sends unauthenticated visitors to /login with one, and app/login/
  // page.tsx honors it after a fresh sign-in. Without this mirror check,
  // a user who ALREADY has a Hub session (e.g. the alfred side held a
  // stale host-only cookie) gets bounced to the Hub home page instead of
  // back to ALFRED, dead-ending the SSO handoff.
  if (user && isLoginPage) {
    const url = request.nextUrl.clone()
    url.pathname = "/"
    url.search = ""
    let target: URL = url
    const redirectParam = request.nextUrl.searchParams.get("redirect")
    if (redirectParam) {
      try {
        const candidate = new URL(redirectParam)
        const host = candidate.hostname.toLowerCase()
        if (
          candidate.protocol === "https:" &&
          (host === "motta.cpa" || host.endsWith(".motta.cpa"))
        ) {
          target = candidate
        }
      } catch {
        // Malformed URL — fall through to the home redirect.
      }
    }
    const redirectResponse = NextResponse.redirect(target)
    // Carry any session cookies updateSession refreshed on this request
    // across the redirect. Dropping them here would discard a rotated
    // refresh token and the destination (especially a cross-subdomain
    // one re-running its own middleware) would be left with a stale one.
    supabaseResponse.cookies
      .getAll()
      .forEach((cookie) => redirectResponse.cookies.set(cookie))
    return redirectResponse
  }

  return supabaseResponse
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|json|js|css)$).*)"],
}
