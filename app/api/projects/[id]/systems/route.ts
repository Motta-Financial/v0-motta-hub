/**
 * Client Systems collection endpoint scoped to a project.
 *
 * POST /api/projects/:id/systems   — add a system row (QuickBooks, Gusto, …)
 *
 * Individual edit / delete lives in ./[systemId]/route.ts.
 */
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid project id" }, { status: 400 })

    const body = await request.json()
    if (!body.name || typeof body.name !== "string") {
      return NextResponse.json({ error: "`name` is required" }, { status: 400 })
    }

    const supabase = createAdminClient()
    const insert = {
      project_id: id,
      name: body.name.trim(),
      system_type: body.system_type || null,
      url: body.url || null,
      username: body.username || null,
      notes: body.notes || null,
      sort_order: Number.isFinite(body.sort_order) ? body.sort_order : 0,
    }

    const { data, error } = await supabase.from("project_systems").insert(insert).select().single()
    if (error) throw error

    return NextResponse.json({ system: data }, { status: 201 })
  } catch (err: any) {
    console.error("[v0] /api/projects/[id]/systems POST failed:", err?.message || err)
    return NextResponse.json({ error: err?.message || "Failed to add system" }, { status: 500 })
  }
}
