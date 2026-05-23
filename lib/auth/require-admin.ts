import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

/**
 * The set of `team_members.role` values that count as platform admins.
 *
 * - "Company" and "Partner" are the firm-leadership tier.
 * - "Admin" is reserved for non-leadership operators that still need
 *   full platform access (e.g. the back-end development lead). This
 *   role gates settings, user mgmt, and the ProConnect "Run full
 *   import" button without conferring partner-level data visibility.
 *
 * If/when an explicit `is_admin` column gets added to `team_members`,
 * swap this constant out for a column check — the rest of this module
 * is intentionally written so that's a one-line change inside
 * `loadCallerAdminStatus`.
 *
 * Exported so admin-only UI (e.g. the /settings/users page) can mirror
 * the same allowlist client-side and hide controls the caller cannot
 * use. The server check below is still authoritative.
 */
export const ADMIN_ROLES = ["Company", "Partner", "Admin"] as const

export type AdminRole = (typeof ADMIN_ROLES)[number]

/**
 * Result returned by `requireAdmin`. A `response` is present when the
 * caller is NOT an admin — return it directly from the route handler.
 * On success, `userId`, `email`, and `role` give the handler everything
 * it needs to audit-log the action.
 */
export type RequireAdminResult =
  | {
      ok: true
      userId: string
      email: string | null
      role: AdminRole
      teamMemberId: string
    }
  | {
      ok: false
      response: NextResponse
    }

/**
 * Guards a route handler so that only admin-tier team members can
 * proceed. Use this on any endpoint that:
 *   • takes a service-role action (bypasses RLS)
 *   • returns plaintext passwords / temporary credentials
 *   • lists other users' auth metadata
 *   • mutates auth_user_id links between accounts
 *
 * Returns 401 when there's no session, and 403 when the session belongs
 * to a non-admin or a deactivated team member. The latter is also a
 * defense in depth on top of the middleware's `is_active` check — if a
 * deactivated user's session cookie is still valid when this handler
 * runs, we still refuse to do anything privileged on their behalf.
 *
 * IMPORTANT: this function calls `auth.getUser()` (network round-trip
 * to Supabase GoTrue), not `getSession()`. We accept the cost because
 * the endpoints this guards are infrequently hit (admin tooling, not
 * per-request hot paths) and we want the strongest revocation check
 * available before doing anything sensitive.
 */
export async function requireAdmin(): Promise<RequireAdminResult> {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    }
  }

  // Find the caller's team_members row. We look up by `auth_user_id`
  // first (the canonical link) and fall back to `email` for legacy
  // accounts that haven't been backfilled yet. Both queries run through
  // the SSR client, which honours RLS — but the caller is always
  // allowed to read their own row in our current policies, so this is
  // safe without service-role escalation.
  const status = await loadCallerAdminStatus(supabase, user.id, user.email ?? null)

  if (!status.found) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Forbidden: no team_members profile" },
        { status: 403 },
      ),
    }
  }

  if (!status.isActive) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Forbidden: account is deactivated" },
        { status: 403 },
      ),
    }
  }

  if (!status.isAdmin) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Forbidden: admin role required" },
        { status: 403 },
      ),
    }
  }

  return {
    ok: true,
    userId: user.id,
    email: user.email ?? null,
    role: status.role,
    teamMemberId: status.teamMemberId,
  }
}

type CallerStatus =
  | { found: false }
  | {
      found: true
      teamMemberId: string
      isActive: boolean
      isAdmin: boolean
      role: AdminRole
    }

/**
 * Two-step lookup that avoids the unsafe PostgREST `.or()` string
 * interpolation pattern that bit us in the middleware. We issue two
 * fully-parameterised queries instead of building an `or=(...)` filter
 * from user-controlled values (email can contain `,` and `)` which
 * break PostgREST's filter parser).
 */
async function loadCallerAdminStatus(
  supabase: Awaited<ReturnType<typeof createClient>>,
  authUserId: string,
  email: string | null,
): Promise<CallerStatus> {
  // Primary lookup: by auth_user_id. This is the canonical link and
  // should match for any user who has signed in at least once.
  const byAuthId = await supabase
    .from("team_members")
    .select("id, role, is_active")
    .eq("auth_user_id", authUserId)
    .maybeSingle()

  if (byAuthId.data) {
    return toStatus(byAuthId.data)
  }

  // Fallback: by email. Only used for accounts that haven't been
  // backfilled with their auth_user_id yet (e.g. a team_member row was
  // created before the user accepted their invite). We compare in a
  // single .eq() call so PostgREST URL-encodes the value safely.
  if (email) {
    const byEmail = await supabase
      .from("team_members")
      .select("id, role, is_active")
      .eq("email", email)
      .maybeSingle()
    if (byEmail.data) {
      return toStatus(byEmail.data)
    }
  }

  return { found: false }
}

function toStatus(row: {
  id: string
  role: string | null
  is_active: boolean | null
}): CallerStatus {
  const role = row.role ?? ""
  const isAdmin = (ADMIN_ROLES as readonly string[]).includes(role)
  return {
    found: true,
    teamMemberId: row.id,
    // is_active defaults to true if null (existing rows from before the
    // column was added). The middleware already enforces an explicit
    // `false` so this matches its semantics.
    isActive: row.is_active !== false,
    isAdmin,
    role: role as AdminRole,
  }
}
