import { NextResponse } from "next/server"
import { createAdminClient, createClient } from "@/lib/supabase/server"

/**
 * Zoom OAuth callback.
 *
 * Two install paths land here:
 *
 *  1. **In-Hub "Connect Zoom" button** -> /api/zoom/oauth/authorize
 *     builds a base64'd `state` JSON containing { team_member_id }
 *     and redirects to Zoom. Zoom redirects back to this route with
 *     `code` + `state`. We exchange the code, look up the user via
 *     /v2/users/me, and upsert into `zoom_connections` keyed on
 *     team_member_id.
 *
 *  2. **Zoom Marketplace "Add to Zoom" button** (the Local Test page,
 *     or the published listing) -> Zoom builds the authorize URL
 *     itself, with NO state parameter, and redirects back here with
 *     just `?code=...`. We can't recover the team_member_id from the
 *     state, so we fall back to looking up the currently-logged-in
 *     Hub user via the Supabase auth cookie -> their `team_members`
 *     row.
 *
 * Every error path redirects to /zoom?error=<code> instead of
 * throwing, so the user always lands on a friendly page. The whole
 * handler is wrapped in a top-level try/catch so even surprises
 * (e.g. a thrown env-var-missing error) get redirected, not 500'd.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const state = searchParams.get("state")
  const oauthError = searchParams.get("error")

  // Resolve the redirect base URL for the post-OAuth landing page.
  //   1. Prefer APP_BASE_URL (hub.motta.cpa). NEXT_PUBLIC_APP_URL in this
  //      project points at the MARKETING site (motta.cpa), which is a
  //      separate Vercel project with no /meetings/zoom page — landing a
  //      freshly-connected user there is the bug this route kept hitting.
  //      Mirror the ProConnect callback, which already prefers APP_BASE_URL.
  //   2. Prepend https:// when a value is missing its scheme, otherwise
  //      NextResponse.redirect() throws ERR_INVALID_URL (it requires
  //      absolute URLs).
  //   3. Strip any trailing slash so the `${baseUrl}/meetings/zoom`
  //      template can't produce a double slash.
  const rawBase =
    process.env.APP_BASE_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim() || origin
  const withScheme = /^https?:\/\//i.test(rawBase) ? rawBase : `https://${rawBase}`
  const baseUrl = withScheme.replace(/\/+$/, "")

  const fail = (reason: string, log?: unknown) => {
    // Always log the failure (even without extra context) so we can see
    // every branch in the server log when the user reports "it didn't
    // work." Tagged with [v0] so it stands out in the debug stream.
    console.error(`[v0] [Zoom OAuth] FAIL: ${reason}`, log ?? "")
    return NextResponse.redirect(`${baseUrl}/meetings/zoom?error=${encodeURIComponent(reason)}`)
  }

  console.log(
    `[v0] [Zoom OAuth] callback hit: code=${code ? "present" : "missing"}, state=${state ? "present" : "missing"}, error=${oauthError ?? "none"}`,
  )

  try {
    if (oauthError) return fail(oauthError)
    if (!code) return fail("missing_code")

    // ── Resolve team_member_id ──────────────────────────────────────
    // Path 1: state was supplied by our /authorize endpoint.
    // Path 2: state is absent (Marketplace install) -> fall back to
    //         the logged-in Hub user.
    let teamMemberId: string | null = null

    if (state) {
      try {
        const decoded = JSON.parse(Buffer.from(state, "base64").toString("utf8"))
        teamMemberId = decoded?.team_member_id ?? null
      } catch (err) {
        console.error("[Zoom OAuth] Failed to decode state:", err)
        // Fall through to session lookup -- a malformed state should
        // not be fatal if we can identify the user another way.
      }
    }

    if (!teamMemberId) {
      // Marketplace install -> read the current Hub user from cookies.
      try {
        const supabase = await createClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()
        console.log(`[v0] [Zoom OAuth] session lookup: user=${user?.email ?? "anonymous"}`)
        if (user?.email) {
          const admin = createAdminClient()
          // Email comparison is case-insensitive because Zoom and
          // Karbon often store the same address with different casing
          // (e.g. "Dat.Le@..." vs "dat.le@..."). The `team_members`
          // table mixes both styles, so an exact match misses real
          // users who do have rows.
          const { data: tm } = await admin
            .from("team_members")
            .select("id, email")
            .ilike("email", user.email)
            .maybeSingle()
          teamMemberId = tm?.id ?? null
          console.log(
            `[v0] [Zoom OAuth] team_member match: ${tm ? `${tm.id} (${tm.email})` : "NO MATCH"}`,
          )
        }
      } catch (err) {
        console.error("[v0] [Zoom OAuth] Session lookup failed:", err)
      }
    }

    if (!teamMemberId) {
      return fail("no_team_member_resolved")
    }
    console.log(`[v0] [Zoom OAuth] resolved team_member_id=${teamMemberId}`)

    // ── Exchange code for tokens ────────────────────────────────────
    const clientId = process.env.ZOOM_CLIENT_ID
    const clientSecret = process.env.ZOOM_CLIENT_SECRET
    const redirectUri = process.env.ZOOM_REDIRECT_URI || `${baseUrl}/api/zoom/oauth/callback`

    if (!clientId || !clientSecret) {
      return fail("server_misconfigured", "Missing ZOOM_CLIENT_ID or ZOOM_CLIENT_SECRET")
    }

    const tokenRes = await fetch("https://zoom.us/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    })

    if (!tokenRes.ok) {
      const body = await tokenRes.text()
      return fail("token_exchange_failed", `${tokenRes.status} ${body}`)
    }
    const tokens = (await tokenRes.json()) as {
      access_token: string
      refresh_token: string
      token_type: string
      expires_in: number
      scope: string
    }

    // ── Fetch the Zoom user profile ─────────────────────────────────
    const userRes = await fetch("https://api.zoom.us/v2/users/me", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    if (!userRes.ok) {
      const body = await userRes.text()
      return fail("user_info_failed", `${userRes.status} ${body}`)
    }
    const zoomUser = (await userRes.json()) as {
      id: string
      account_id?: string
      email?: string
      first_name?: string
      last_name?: string
      display_name?: string
      pic_url?: string
      timezone?: string
      type?: number
      pmi?: number
      personal_meeting_url?: string
    }

    // ── Persist the connection ──────────────────────────────────────
    const admin = createAdminClient()
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    const { error: upsertError } = await admin.from("zoom_connections").upsert(
      {
        team_member_id: teamMemberId,
        zoom_user_id: zoomUser.id,
        zoom_account_id: zoomUser.account_id ?? null,
        zoom_email: zoomUser.email ?? null,
        zoom_first_name: zoomUser.first_name ?? null,
        zoom_last_name: zoomUser.last_name ?? null,
        zoom_display_name:
          zoomUser.display_name ||
          `${zoomUser.first_name ?? ""} ${zoomUser.last_name ?? ""}`.trim() ||
          zoomUser.email ||
          null,
        zoom_pic_url: zoomUser.pic_url ?? null,
        zoom_timezone: zoomUser.timezone ?? null,
        zoom_user_type: zoomUser.type ?? null,
        zoom_pmi: zoomUser.pmi?.toString() ?? null,
        zoom_personal_meeting_url: zoomUser.personal_meeting_url ?? null,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_type: tokens.token_type,
        expires_at: expiresAt,
        scope: tokens.scope,
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "team_member_id" },
    )

    if (upsertError) return fail("save_failed", upsertError)

    console.log(
      `[v0] [Zoom OAuth] SUCCESS: connected ${zoomUser.email} (zoom_user_id=${zoomUser.id}) to team_member ${teamMemberId}`,
    )
    return NextResponse.redirect(`${baseUrl}/meetings/zoom?success=true`)
  } catch (err) {
    return fail("callback_failed", err)
  }
}
