/**
 * Project ↔ Client linkage — single row mutations.
 *
 *   PATCH  /api/projects/:id/clients/:clientRowId
 *     body: { role?, ownership_pct?, notes?, is_primary? }
 *   DELETE /api/projects/:id/clients/:clientRowId
 *
 * Setting `is_primary = true` demotes any other primary on the project,
 * and mirrors the new primary's id onto projects.organization_id /
 * projects.contact_id. Deleting the primary leaves the project with NO
 * primary; the caller is expected to set a new one immediately.
 */
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; clientRowId: string }> },
) {
  try {
    const { id, clientRowId } = await params
    if (!UUID_RE.test(id) || !UUID_RE.test(clientRowId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 })
    }
    const body = await request.json()

    const patch: Record<string, any> = {}
    if (typeof body.role === "string") patch.role = body.role.slice(0, 64)
    if ("ownership_pct" in body) patch.ownership_pct = body.ownership_pct
    if ("notes" in body) patch.notes = body.notes
    if (typeof body.is_primary === "boolean") patch.is_primary = body.is_primary

    const supabase = createAdminClient()

    if (patch.is_primary === true) {
      await supabase
        .from("project_clients")
        .update({ is_primary: false })
        .eq("project_id", id)
        .eq("is_primary", true)
    }

    const { data, error } = await supabase
      .from("project_clients")
      .update(patch)
      .eq("id", clientRowId)
      .eq("project_id", id)
      .select()
      .single()
    if (error) throw error

    if (patch.is_primary === true && data) {
      await supabase
        .from("projects")
        .update({ organization_id: data.organization_id, contact_id: data.contact_id })
        .eq("id", id)
    }

    return NextResponse.json({ client: data })
  } catch (err: any) {
    console.error("[v0] /api/projects/[id]/clients/[id] PATCH failed:", err?.message || err)
    return NextResponse.json({ error: err?.message || "Failed to update client" }, { status: 500 })
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; clientRowId: string }> },
) {
  try {
    const { id, clientRowId } = await params
    if (!UUID_RE.test(id) || !UUID_RE.test(clientRowId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 })
    }
    const supabase = createAdminClient()

    const { data: row } = await supabase
      .from("project_clients")
      .select("is_primary, organization_id, contact_id")
      .eq("id", clientRowId)
      .eq("project_id", id)
      .maybeSingle()

    const { error } = await supabase
      .from("project_clients")
      .delete()
      .eq("id", clientRowId)
      .eq("project_id", id)
    if (error) throw error

    // If we just removed the primary, blank out the mirror columns. The UI
    // should immediately prompt for a new primary.
    if (row?.is_primary) {
      await supabase
        .from("projects")
        .update({ organization_id: null, contact_id: null })
        .eq("id", id)
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error("[v0] /api/projects/[id]/clients/[id] DELETE failed:", err?.message || err)
    return NextResponse.json({ error: "Failed to remove client" }, { status: 500 })
  }
}
