import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers"

/**
 * Auth guard for the ALFRED data REST endpoints
 * (`/api/alfred/{data,schema,search,stats}`).
 *
 * Accepts EITHER:
 *   1. A valid Supabase session cookie (a logged-in Hub team member), OR
 *   2. A header `x-alfred-secret` whose value matches
 *      `process.env.ALFRED_API_SECRET` (server-to-server / external
 *      ALFRED service callers).
 *
 * Returns `null` when the caller is authorized — the route handler should
 * continue. Returns a `NextResponse` (401 / 503) when not authorized — the
 * route handler should return it directly.
 *
 * This mirrors the `isInternalCall` shared-secret pattern that
 * `middleware.ts` already uses for the Karbon CRON sync chain
 * (`x-internal-secret` + `CRON_SECRET`), but scoped to ALFRED so the two
 * secrets can be rotated independently.
 *
 * IMPORTANT: this helper does NOT cover `/api/alfred/chat` — the chat
 * route handles its own session-based auth and is allowed through
 * middleware separately.
 */
export async function requireAlfredAuth(
  request: NextRequest,
): Promise<NextResponse | null> {
  // 1. Server-to-server shared-secret path. Constant-time-ish comparison
  //    via direct equality is fine here because the secret is fetched
  //    from env (not user-controlled) and length-mismatched input can't
  //    leak meaningful timing data on a single equality check at the
  //    Node runtime layer.
  const expected = process.env.ALFRED_API_SECRET
  const presented = request.headers.get("x-alfred-secret")

  if (presented) {
    if (!expected) {
      // The header was supplied but the env var isn't configured. Fail
      // closed and surface a clear ops-level error rather than silently
      // falling through to the cookie check (which would 401 the caller
      // with a confusing "Unauthorized" instead of "misconfigured").
      return NextResponse.json(
        {
          success: false,
          error:
            "ALFRED_API_SECRET is not configured on the server. Set it in Vercel project env vars.",
        },
        { status: 503 },
      )
    }
    if (presented === expected) {
      return null // Authorized via shared secret.
    }
    // Bad secret presented — short-circuit. We do NOT fall through to the
    // cookie check, otherwise an attacker could probe with a junk header
    // and a stolen session cookie.
    return NextResponse.json(
      { success: false, error: "Invalid x-alfred-secret header" },
      { status: 401 },
    )
  }

  // 2. Cookie-session path. Any authenticated Hub team member is allowed
  //    through; further per-table authorization is up to the route
  //    handler. (Today the routes intentionally trust the session — the
  //    UI never calls these endpoints directly, only ALFRED does, but we
  //    leave the door open so debugging from a logged-in browser tab
  //    works without rotating the shared secret.)
  //
  // IMPORTANT: we use `getAuthenticatedUser()` (local JWT verify via
  // getSession + signature check) instead of `supabase.auth.getUser()`
  // here. The latter makes a network round-trip to Supabase's
  // `/auth/v1/user` endpoint on EVERY call, and Alfred's 8 API routes
  // hitting it on every chat turn was generating tens of thousands of
  // auth requests per day -- the dominant source of the per-project
  // auth-request budget burn and the per-IP rate limiting that was
  // locking users out of sign-in. The JWT we verify locally is the
  // same one GoTrue signs, so the identity is trustworthy for the
  // lifetime of the access token.
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await getAuthenticatedUser(supabase)
    if (user) {
      return null // Authorized via Supabase session.
    }
  } catch {
    // If Supabase auth itself fails (env vars missing, network blip),
    // fall through to the 401 below rather than 500-ing.
  }

  return NextResponse.json(
    {
      success: false,
      error:
        "Unauthorized. Provide a Supabase session cookie or an `x-alfred-secret` header.",
    },
    { status: 401 },
  )
}
