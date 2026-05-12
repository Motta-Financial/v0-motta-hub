/**
 * Single Client System row CRUD scoped to a project.
 *
 * PATCH  /api/projects/:id/systems/:systemId   — edit fields
 * DELETE /api/projects/:id/systems/:systemId   — remove system row
 *
 * Both routes verify the row belongs to the named project so a leaked system
 * id can't be used to mutate a different project's data.
 */
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; systemId: string }> },
) {
  try {
    const { id, systemId } = await params
    if (!UUID_RE.test(id) || !UUID_RE.test(systemId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 })
    }
    const body = await request.json()

    const allowed = ["name", "system_type", "url", "username", "notes", "sort_order"] as const
    const patch: Record<string, any> = {}
    for (const k of allowed) if (k in body) patch[k] = body[k]
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No updatable fields supplied" }, { status: 400 })
    }

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from("project_systems")
      .update(patch)
      .eq("id", systemId)
      .eq("project_id", id)
      .select()
      .single()
    if (error) throw error
    return NextResponse.json({ system: data })
  } catch (err: any) {
    console.error("[v0] /api/projects/[id]/systems/[systemId] PATCH failed:", err?.message || err)
    return NextResponse.json({ error: err?.message || "Failed to update system" }, { status: 500 })
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; systemId: string }> },
) {
  try {
    const { id, systemId } = await params
    if (!UUID_RE.test(id) || !UUID_RE.test(systemId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 })
    }
    const supabase = createAdminClient()
    const { error } = await supabase
      .from("project_systems")
      .delete()
      .eq("id", systemId)
      .eq("project_id", id)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error("[v0] /api/projects/[id]/systems/[systemId] DELETE failed:", err?.message || err)
    return NextResponse.json({ error: "Failed to delete system" }, { status: 500 })
  }
}
