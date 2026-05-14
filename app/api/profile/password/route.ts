import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient()

    // SENSITIVE ROUTE: we intentionally keep the full `getUser()`
    // network round-trip here (rather than the cached local
    // verification in lib/supabase/auth-helpers.ts) because we're about
    // to mutate the user's password. The extra ~150ms is a fine
    // trade-off to ensure we're acting on a non-revoked, verified
    // session.
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { newPassword } = body

    if (!newPassword || newPassword.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 })
    }

    // Update the user's password
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    })

    if (error) {
      console.error("Error updating password:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // IMPORTANT: kill the current session server-side after the
    // password change.
    //
    // Supabase's default behavior on `updateUser({ password })` is to
    // rotate THIS session's access+refresh tokens AND revoke every
    // other refresh token for the user (kill-other-sessions). That
    // sounds clean but in practice it produced a nasty cascade:
    //   - Other open tabs (and any other devices) silently held a
    //     now-revoked refresh token.
    //   - On their next auto-refresh (~50 min cycle), each tab would
    //     hit GoTrue with a revoked token, get a 400, fire SIGNED_OUT,
    //     and redirect to /login.
    //   - Multiple revoke responses + multiple /login retries from the
    //     same office NAT IP saturated Supabase's per-IP auth limiter
    //     (~30 requests / 5 min on Cloud) -- after which legitimate
    //     `signInWithPassword` calls started returning "Request rate
    //     limit reached" too.
    //
    // By signing the current session out ourselves and telling the
    // client to redirect to /login, we make the post-password-change
    // state explicit: one clean sign-in event instead of a fleet of
    // failing refreshes. We use `scope: 'local'` so this signOut call
    // itself doesn't burn an extra GoTrue round-trip -- the cookies
    // are cleared locally and the access token will simply expire on
    // its normal TTL.
    await supabase.auth.signOut({ scope: "local" })

    // `requireRelogin: true` is the contract with the client: see
    // app/settings/profile/page.tsx -- on receipt of this flag the
    // page wipes its in-memory Supabase session and redirects to
    // /login?message=password_changed.
    return NextResponse.json({ success: true, requireRelogin: true })
  } catch (error) {
    console.error("Password update error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update password" },
      { status: 500 },
    )
  }
}
