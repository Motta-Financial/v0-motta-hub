import { updateSession } from "@/lib/supabase/middleware"
import { NextResponse, type NextRequest } from "next/server"

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

  const { supabaseResponse, user } = result

  const isLoginPage = pathname === "/login"
  const isAuthCallback = pathname.startsWith("/auth")
  const isPublicApi = pathname.startsWith("/api/alfred")
  const isWebhook = pathname.startsWith("/api/webhooks") || pathname.startsWith("/api/karbon/webhooks")
  const isCron = pathname.startsWith("/api/cron")

  // Allow internal server-to-server calls (e.g. cron -> /api/karbon/sync -> /api/karbon/contacts)
  // These pass a shared secret so middleware doesn't block the sync chain.
  const isInternalCall =
    pathname.startsWith("/api/karbon/") &&
    process.env.CRON_SECRET &&
    request.headers.get("x-internal-secret") === process.env.CRON_SECRET

  // Allow auth callback, public API, webhooks, cron, and internal calls without auth checks
  if (isAuthCallback || isPublicApi || isWebhook || isCron || isInternalCall) {
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
