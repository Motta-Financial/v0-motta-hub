/**
 * GET    /api/prospects/[id] — fetch full prospect submission + the
 *                              creator/assignee profile pair for the
 *                              detail page.
 * PATCH  /api/prospects/[id] — update mutable triage fields
 *                              (lead_status, assigned_to_id,
 *                              triage_notes, internal_notes).
 *
 * Mirrors the shape of `app/api/jotform/intake/[id]/route.ts` so the
 * detail page can reuse most of the same client component patterns.
 */

import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid prospect id" }, { status: 400 })
  }

  const supabase = createAdminClient()

  // Pull the prospect plus the two team_members it points at — the
  // creator (always set) and the assignee (defaults to the creator).
  // Done as parallel single-row reads instead of a join because
  // Supabase's PostgREST embedding syntax gets awkward for two FKs
  // to the same table, and this stays trivial to debug.
  const { data: prospect, error } = await supabase
    .from("prospect_submissions")
    .select("*")
    .eq("id", id)
    .maybeSingle()

  if (error) {
    console.error("[v0] GET /api/prospects/[id] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!prospect) {
    return NextResponse.json({ error: "Prospect not found" }, { status: 404 })
  }

  const teamIds = Array.from(
    new Set(
      [prospect.created_by_id, prospect.assigned_to_id].filter(
        (v): v is string => !!v,
      ),
    ),
  )

  const teamLookup = new Map<
    string,
    { id: string; full_name: string | null; avatar_url: string | null; email: string | null }
  >()
  if (teamIds.length > 0) {
    const { data: members } = await supabase
      .from("team_members")
      .select("id, full_name, avatar_url, email")
      .in("id", teamIds)
    for (const m of members ?? []) {
      teamLookup.set(m.id, m)
    }
  }

  // Pull the linked client name in one shot so the detail page can
  // render a "Linked to <client>" chip without a second round-trip.
  let linkedClient:
    | { type: "contact" | "organization"; id: string; name: string }
    | null = null
  if (prospect.contact_id) {
    const { data: c } = await supabase
      .from("contacts")
      .select("id, full_name")
      .eq("id", prospect.contact_id)
      .maybeSingle()
    if (c) linkedClient = { type: "contact", id: c.id, name: c.full_name ?? "Unnamed contact" }
  } else if (prospect.organization_id) {
    const { data: o } = await supabase
      .from("organizations")
      .select("id, name, full_name")
      .eq("id", prospect.organization_id)
      .maybeSingle()
    if (o)
      linkedClient = {
        type: "organization",
        id: o.id,
        name: o.full_name ?? o.name ?? "Unnamed organization",
      }
  }

  return NextResponse.json({
    prospect,
    createdBy: prospect.created_by_id ? teamLookup.get(prospect.created_by_id) ?? null : null,
    assignedTo: prospect.assigned_to_id ? teamLookup.get(prospect.assigned_to_id) ?? null : null,
    linkedClient,
  })
}

interface PatchBody {
  lead_status?: string | null
  assigned_to_id?: string | null
  triage_notes?: string | null
  internal_notes?: string | null
}

const ALLOWED_STATUSES = new Set([
  "new",
  "contacted",
  "qualified",
  "converted",
  "declined",
])

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid prospect id" }, { status: 400 })
  }

  const body = (await req.json().catch(() => ({}))) as PatchBody
  const patch: Record<string, unknown> = {}

  if (body.lead_status !== undefined) {
    if (body.lead_status !== null && !ALLOWED_STATUSES.has(body.lead_status)) {
      return NextResponse.json({ error: "Invalid lead_status" }, { status: 400 })
    }
    patch.lead_status = body.lead_status
  }
  if (body.assigned_to_id !== undefined) {
    if (body.assigned_to_id !== null && !isUuid(body.assigned_to_id)) {
      return NextResponse.json({ error: "Invalid assigned_to_id" }, { status: 400 })
    }
    patch.assigned_to_id = body.assigned_to_id
  }
  if (body.triage_notes !== undefined) {
    patch.triage_notes = body.triage_notes ? String(body.triage_notes) : null
  }
  if (body.internal_notes !== undefined) {
    patch.internal_notes = body.internal_notes ? String(body.internal_notes) : null
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No mutable fields supplied" }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from("prospect_submissions")
    .update(patch)
    .eq("id", id)

  if (error) {
    console.error("[v0] PATCH /api/prospects/[id] error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
