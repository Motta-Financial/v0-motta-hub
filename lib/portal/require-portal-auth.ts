import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

/**
 * One entity (contact or organization record) a portal login can see.
 * A single login can have several of these (e.g. a business owner with
 * both a personal 1040 contact record and a company organization record).
 */
export interface PortalAccessEntity {
  type: "contact" | "organization"
  id: string
}

/**
 * Shape returned on a successful portal auth check.
 */
export interface PortalUser {
  id: string
  authUserId: string
  email: string
  fullName: string | null
  entities: PortalAccessEntity[]
  contactIds: string[]
  organizationIds: string[]
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
 *  3. At least one `portal_user_access` row grants entity access.
 *
 * Returns 401 when no session, 403 when no portal_users row, inactive, or
 * no granted access. On success returns the caller's PortalUser with every
 * contact_id/organization_id they're allowed to see, so handlers can scope
 * queries with `.in("contact_id", portalUser.contactIds)` etc. — RLS also
 * enforces this at the database level as defense in depth.
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
    .select(
      "id, auth_user_id, email, full_name, is_active, portal_user_access(contact_id, organization_id)",
    )
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

  const accessRows = (row.portal_user_access ?? []) as {
    contact_id: string | null
    organization_id: string | null
  }[]

  const entities: PortalAccessEntity[] = accessRows.map((r) =>
    r.contact_id
      ? { type: "contact" as const, id: r.contact_id }
      : { type: "organization" as const, id: r.organization_id as string },
  )

  if (entities.length === 0) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Forbidden: no linked accounts" },
        { status: 403 },
      ),
    }
  }

  return {
    ok: true,
    portalUser: {
      id: row.id,
      authUserId: row.auth_user_id,
      email: row.email,
      fullName: row.full_name,
      entities,
      contactIds: entities.filter((e) => e.type === "contact").map((e) => e.id),
      organizationIds: entities
        .filter((e) => e.type === "organization")
        .map((e) => e.id),
    },
  }
}
