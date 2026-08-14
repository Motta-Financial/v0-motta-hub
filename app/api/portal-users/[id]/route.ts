import { NextResponse, type NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * PATCH /api/portal-users/[id]
 * Body: { isActive: boolean }
 *
 * Activates/deactivates a portal login account (id = portal_users.id).
 * Deactivating blocks login entirely, across every entity that account can
 * see — requirePortalAuth() and the client-portal login page both check
 * `is_active`. Use the DELETE handler below to revoke just one entity's
 * access instead of the whole account.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const { isActive } = body as { isActive?: boolean }

    if (typeof isActive !== "boolean") {
      return NextResponse.json({ error: "isActive (boolean) is required" }, { status: 400 })
    }

    const admin = createAdminClient()
    const { data, error } = await admin
      .from("portal_users")
      .update({ is_active: isActive })
      .eq("id", id)
      .select("id, is_active")
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: "Portal user not found" }, { status: 404 })
    }

    return NextResponse.json({ ok: true, isActive: data.is_active })
  } catch (error) {
    console.error("[v0] PATCH /api/portal-users/[id] error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update portal user" },
      { status: 500 },
    )
  }
}

/**
 * DELETE /api/portal-users/[id]?kind=contact|organization&entityId=...
 *
 * Revokes access to ONE linked entity (removes the `portal_user_access`
 * row) without touching the login account itself — a client with access to
 * both a personal and a business return keeps signing in either way.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
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

    const { error } = await admin
      .from("portal_user_access")
      .delete()
      .eq("portal_user_id", id)
      .eq(column, entityId)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("[v0] DELETE /api/portal-users/[id] error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to revoke portal access" },
      { status: 500 },
    )
  }
}
