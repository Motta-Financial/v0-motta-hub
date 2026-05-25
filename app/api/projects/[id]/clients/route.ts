/**
 * Project ↔ Client linkage.
 *
 *   GET    /api/projects/:id/clients          — list project_clients (enriched)
 *   POST   /api/projects/:id/clients          — add a client
 *     body: { organization_id?, contact_id?, role?, ownership_pct?, is_primary? }
 *
 * The list also keeps `projects.organization_id` / `projects.contact_id`
 * mirrored to the row marked `is_primary = true` so legacy callers that
 * read those columns directly stay correct.
 */
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid project id" }, { status: 400 })

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from("project_clients")
      .select(
        `id, project_id, organization_id, contact_id, role, is_primary, ownership_pct, notes, created_at,
         organization:organizations (id, name, full_name, karbon_url, primary_email, phone, entity_type),
         contact:contacts (id, full_name, primary_email, phone_primary, karbon_url, entity_type)`,
      )
      .eq("project_id", id)
      .order("is_primary", { ascending: false })
      .order("role", { ascending: true })

    if (error) throw error

    const clients = (data || []).map((row: any) => ({
      id: row.id,
      kind: row.organization_id ? "organization" : "contact",
      client_id: row.organization_id || row.contact_id,
      role: row.role,
      is_primary: row.is_primary,
      ownership_pct: row.ownership_pct,
      notes: row.notes,
      name:
        row.organization?.name ||
        row.organization?.full_name ||
        row.contact?.full_name ||
        "Unknown",
      email: row.organization?.primary_email || row.contact?.primary_email || null,
      phone: row.organization?.phone || row.contact?.phone_primary || null,
      entity_type: row.organization?.entity_type || row.contact?.entity_type || null,
      karbon_url: row.organization?.karbon_url || row.contact?.karbon_url || null,
    }))

    return NextResponse.json({ clients })
  } catch (err: any) {
    console.error("[v0] /api/projects/[id]/clients GET failed:", err?.message || err)
    return NextResponse.json({ error: "Failed to list project clients" }, { status: 500 })
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid project id" }, { status: 400 })
    const body = await request.json()

    const orgId = body.organization_id || null
    const contactId = body.contact_id || null
    if ((!orgId && !contactId) || (orgId && contactId)) {
      return NextResponse.json(
        { error: "Provide exactly one of organization_id or contact_id" },
        { status: 400 },
      )
    }

    const supabase = createAdminClient()
    const role = (body.role || "primary").toString().slice(0, 64)
    const isPrimary = body.is_primary === true

    // If is_primary, demote any existing primary on this project.
    if (isPrimary) {
      await supabase.from("project_clients").update({ is_primary: false }).eq("project_id", id).eq("is_primary", true)
    }

    const { data, error } = await supabase
      .from("project_clients")
      .insert({
        project_id: id,
        organization_id: orgId,
        contact_id: contactId,
        role,
        is_primary: isPrimary,
        ownership_pct: body.ownership_pct ?? null,
        notes: body.notes ?? null,
      })
      .select()
      .single()
    if (error) throw error

    // Mirror primary back onto projects.organization_id / contact_id so the
    // existing detail/list endpoints keep working.
    if (isPrimary) {
      await supabase
        .from("projects")
        .update({ organization_id: orgId, contact_id: contactId })
        .eq("id", id)
    }

    return NextResponse.json({ client: data }, { status: 201 })
  } catch (err: any) {
    console.error("[v0] /api/projects/[id]/clients POST failed:", err?.message || err)
    return NextResponse.json({ error: err?.message || "Failed to add client" }, { status: 500 })
  }
}
