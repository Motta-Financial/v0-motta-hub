import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

/**
 * Shape returned on a successful portal auth check.
 */
export interface PortalUser {
  id: string
  authUserId: string
  clientId: string
  email: string
  fullName: string | null
  role: "client" | "client_contact"
}

export type RequirePortalAuthResult =
  | { ok: true; portalUser: PortalUser }
  | { ok: false; response: NextResponse }

/**
 * Guards a portal API route handler.
 *
 * Checks:
 *  1. Supabase session exists (auth.getUser — authoritative, not cached).
 *  2. A `portal_users` row exists for this auth user AND is_active = true.
 *
 * Returns 401 when no session, 403 when no portal_users row or inactive.
 * On success returns the caller's PortalUser so the handler can scope
 * every query to `portalUser.clientId` without a second round-trip.
 *
 * NOTE: We intentionally do NOT check `team_members` here. Portal routes
 * are clean — a team member cannot access portal API routes as a client.
 * The only exception is the team-side messaging endpoint (handled there
 * via requireAdmin / requireLeadership instead).
 */
export async function requirePortalAuth(): Promise<RequirePortalAuthResult> {
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

  const { data: row, error: dbError } = await supabase
    .from("portal_users")
    .select("id, auth_user_id, client_id, email, full_name, role, is_active")
    .eq("auth_user_id", user.id)
    .maybeSingle()

  if (dbError || !row) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Forbidden: no portal access" },
        { status: 403 },
      ),
    }
  }

  if (!row.is_active) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Forbidden: portal access deactivated" },
        { status: 403 },
      ),
    }
  }

  return {
    ok: true,
    portalUser: {
      id: row.id,
      authUserId: row.auth_user_id,
      clientId: row.client_id,
      email: row.email,
      fullName: row.full_name,
      role: row.role as "client" | "client_contact",
    },
  }
}
