import { NextResponse, type NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * GET /api/portal-users?kind=contact|organization&entityId=...
 *
 * Lists every portal login granted access to the given contact/organization,
 * for the "Client Portal Access" card on the client detail page. Staff-only
 * by virtue of middleware.ts requiring a Hub session on every /api/* route —
 * this never runs client-side against the portal's own RLS-scoped client.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const kind = searchParams.get("kind")
    const entityId = searchParams.get("entityId")

    if (kind !== "contact" && kind !== "organization") {
      return NextResponse.json({ error: "kind must be 'contact' or 'organization'" }, { status: 400 })
    }
    if (!entityId) {
      return NextResponse.json({ error: "Missing entityId" }, { status: 400 })
    }

    const admin = createAdminClient()
    const column = kind === "organization" ? "organization_id" : "contact_id"

    const { data, error } = await admin
      .from("portal_user_access")
      .select(
        "id, created_at, portal_users(id, email, full_name, is_active, last_login_at, created_at)",
      )
      .eq(column, entityId)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const grants = (data ?? [])
      .map((row) => {
        const pu = row.portal_users as unknown as {
          id: string
          email: string
          full_name: string | null
          is_active: boolean
          last_login_at: string | null
          created_at: string
        } | null
        if (!pu) return null
        return {
          accessId: row.id,
          portalUserId: pu.id,
          email: pu.email,
          fullName: pu.full_name,
          isActive: pu.is_active,
          lastLoginAt: pu.last_login_at,
          grantedAt: row.created_at,
        }
      })
      .filter((g): g is NonNullable<typeof g> => g !== null)

    return NextResponse.json({ grants })
  } catch (error) {
    console.error("[v0] GET /api/portal-users error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load portal access" },
      { status: 500 },
    )
  }
}
