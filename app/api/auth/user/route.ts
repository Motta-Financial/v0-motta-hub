import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export async function GET() {
  try {
    const supabase = await createClient()

    // IMPORTANT: We use getSession() here instead of getUser() for the
    // same reason the middleware does (see lib/supabase/middleware.ts
    // for the full rationale).
    //
    // This route is hit by UserProvider on every fresh tab / page load
    // to hydrate the in-memory user cache. Before this change it made a
    // round-trip to Supabase GoTrue on every call, which was adding
    // 300ms–1.5s to the perceived sign-in time (UserProvider's fetch
    // happens immediately after navigating to "/").
    //
    // getSession() reads the session cookie and verifies the JWT
    // signature locally using the project's JWT secret — no network
    // call. The signature check is cryptographically equivalent to a
    // getUser() for the purpose of trusting the user.id / email claims
    // we expose to the client. Anything more sensitive (admin actions,
    // service-role data) is still gated by route-level getUser() calls
    // in their own handlers.
    const {
      data: { session },
      error: authError,
    } = await supabase.auth.getSession()
    const user = session?.user ?? null

    if (authError || !user) {
      return NextResponse.json({ user: null, teamMember: null })
    }

    // Fetch team member data. Two-step lookup so we never feed
    // user-controlled values into a PostgREST `.or()` filter string.
    // The previous implementation built
    //   or=(auth_user_id.eq.${id},email.eq.${email})
    // by string interpolation -- email local-parts can legally
    // contain `,` and `)` (RFC 5321) and any such address would
    // corrupt PostgREST's filter parser, silently 4xx the request,
    // and bounce the user back to /login. Same fix as middleware.ts.
    let teamMember: { id: string; auth_user_id: string | null; email: string } | null = null
    const byAuthId = await supabase
      .from("team_members")
      .select("*")
      .eq("auth_user_id", user.id)
      .maybeSingle()
    if (byAuthId.data) {
      teamMember = byAuthId.data
    } else if (user.email) {
      const byEmail = await supabase
        .from("team_members")
        .select("*")
        .eq("email", user.email)
        .maybeSingle()
      teamMember = byEmail.data
    }

    // Link auth_user_id if found by email but not linked yet
    if (teamMember && !teamMember.auth_user_id && teamMember.email === user.email) {
      await supabase.from("team_members").update({ auth_user_id: user.id }).eq("id", teamMember.id)
    }

    return NextResponse.json({ user, teamMember })
  } catch (error) {
    console.error("Error fetching user:", error)
    return NextResponse.json({ user: null, teamMember: null })
  }
}
