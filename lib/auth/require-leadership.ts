import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { LEADERSHIP_ROLES, type LeadershipRole } from "@/lib/auth/leadership-roles"

// Re-export the constant + helpers so existing imports of
// `LEADERSHIP_ROLES` / `isLeadershipRole` from this module keep working.
// The actual definitions live in `leadership-roles.ts` so client
// components can import them without pulling in `next/server`.
export { LEADERSHIP_ROLES, isLeadershipRole, type LeadershipRole } from "@/lib/auth/leadership-roles"

/**
 * Result returned by `requireLeadership`. A `response` is present when
 * the caller is NOT leadership — return it directly from the route
 * handler. On success, `userId`, `email`, and `role` give the handler
 * everything it needs to audit-log the action.
 */
export type RequireLeadershipResult =
  | {
      ok: true
      userId: string
      email: string | null
      role: LeadershipRole
      teamMemberId: string
    }
  | {
      ok: false
      response: NextResponse
    }

/**
 * Guards a route handler so that only leadership-tier (PPD) team
 * members can proceed. Use this on any endpoint that surfaces
 * firm-wide compensation / hours / profitability data.
 *
 * Returns 401 when there's no session, and 403 when the session
 * belongs to a non-PPD or a deactivated team member.
 *
 * IMPORTANT: this calls `auth.getUser()` (network round-trip to
 * Supabase GoTrue), not `getSession()`. We accept the cost because the
 * endpoints this guards are infrequently hit and we want the strongest
 * revocation check available before exposing firm-wide hours.
 */
export async function requireLeadership(): Promise<RequireLeadershipResult> {
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

  const status = await loadCallerLeadershipStatus(supabase, user.id, user.email ?? null)

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

  if (!status.isLeadership) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Forbidden: leadership role required" },
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
      isLeadership: boolean
      role: LeadershipRole
    }

/**
 * Two-step lookup that mirrors `loadCallerAdminStatus` in
 * `require-admin.ts`. Avoids the unsafe PostgREST `.or()` string
 * interpolation pattern by issuing two fully-parameterised queries
 * instead of building an `or=(...)` filter from user-controlled values.
 */
async function loadCallerLeadershipStatus(
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

  // Fallback: by email, for accounts not yet backfilled with their
  // auth_user_id. Compared in a single .eq() call so PostgREST
  // URL-encodes the value safely.
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
  const isLeadership = (LEADERSHIP_ROLES as readonly string[]).includes(role)
  return {
    found: true,
    teamMemberId: row.id,
    isActive: row.is_active !== false,
    isLeadership,
    role: role as LeadershipRole,
  }
}
