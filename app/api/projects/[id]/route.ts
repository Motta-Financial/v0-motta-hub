/**
 * Project detail endpoint.
 *
 * GET    /api/projects/:id   — full project view: header, client, systems,
 *                              matching Karbon work items, related Ignition
 *                              services, intakes, debriefs, meeting recordings.
 * PATCH  /api/projects/:id   — update top-level project fields.
 * DELETE /api/projects/:id   — delete project (cascades to project_systems).
 *
 * The "matching work items" list is computed live by filtering all work items
 * belonging to the project's client through the project's
 * `work_template_pattern` / `work_type_pattern`. New monthly Karbon items will
 * appear automatically on the next sync — no backfill required.
 */
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isCompleted(w: any): boolean {
  const s = String(w.status || w.primary_status || "").toLowerCase()
  return s.includes("complete") || s.includes("cancel") || s.includes("archived")
}

function projectMatches(p: any, w: any): boolean {
  if (!p.work_type_pattern && !p.work_template_pattern) return true
  const wt = String(w.work_type || "").toLowerCase()
  const tn = String(w.work_template_name || "").toLowerCase()
  const ttl = String(w.title || "").toLowerCase()
  const matchTemplate = p.work_template_pattern
    ? tn.includes(p.work_template_pattern.toLowerCase()) || ttl.includes(p.work_template_pattern.toLowerCase())
    : true
  const matchType = p.work_type_pattern ? wt.includes(p.work_type_pattern.toLowerCase()) : true
  return matchTemplate && matchType
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Invalid project id" }, { status: 400 })
    }

    const supabase = createAdminClient()

    const { data: project, error: pErr } = await supabase
      .from("projects")
      .select("*")
      .eq("id", id)
      .maybeSingle()
    if (pErr) throw pErr
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 })

    const isOrg = !!project.organization_id
    const entityId = project.organization_id || project.contact_id
    const idCol = isOrg ? "organization_id" : "contact_id"

    // Fan out related lookups in parallel.
    const [orgRes, contactRes, systemsRes, workItemsRes, proposalsRes, intakesRes, debriefsRes, meetingsRes, recordingsRes, ownerRes] = await Promise.all([
      isOrg
        ? supabase
            .from("organizations")
            .select(
              "id, name, full_name, karbon_organization_key, karbon_url, primary_email, phone, industry, entity_type, status",
            )
            .eq("id", entityId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      !isOrg
        ? supabase
            .from("contacts")
            .select(
              "id, full_name, primary_email, phone_primary, karbon_contact_key, karbon_url, entity_type, status",
            )
            .eq("id", entityId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),

      supabase
        .from("project_systems")
        .select("*")
        .eq("project_id", id)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),

      supabase
        .from("work_items")
        .select(
          "id, karbon_work_item_key, title, work_type, work_template_name, status, primary_status, secondary_status, workflow_status, assignee_name, due_date, start_date, completed_date, period_start, period_end, karbon_url, priority, todo_count, completed_todo_count, has_blocking_todos, karbon_modified_at, deleted_in_karbon_at",
        )
        .eq(idCol, entityId)
        .is("deleted_in_karbon_at", null)
        .order("start_date", { ascending: false, nullsFirst: false })
        .limit(500),

      // Ignition proposals + services for this client (background context)
      supabase
        .from("ignition_proposals")
        .select(
          `proposal_id, proposal_number, title, status, total_value, recurring_total, recurring_frequency, currency, sent_at, accepted_at, completed_at, lost_at, signed_url,
           services:ignition_proposal_services (
             id, service_name, description, quantity, unit_price, total_amount, currency, billing_frequency, billing_type, status, start_date, end_date
           )`,
        )
        .eq(idCol, entityId)
        .order("accepted_at", { ascending: false, nullsFirst: false })
        .limit(50),

      supabase
        .from("jotform_intake_submissions")
        .select(
          "id, jotform_submission_id, jotform_created_at, submitter_full_name, submitter_email, business_name, service_focus, services_requested, lead_status, link_method, karbon_work_item_url",
        )
        .eq(idCol, entityId)
        .order("jotform_created_at", { ascending: false, nullsFirst: false })
        .limit(20),

      supabase
        .from("debriefs_full")
        .select(
          "id, debrief_date, debrief_type, status, follow_up_date, tax_year, notes, action_items, work_item_id, work_item_title, work_item_karbon_url, team_member_full_name, created_at",
        )
        .eq(idCol, entityId)
        .order("debrief_date", { ascending: false, nullsFirst: false })
        .limit(50),

      supabase
        .from("meetings")
        .select(
          "id, title, meeting_type, status, scheduled_start, scheduled_end, duration_minutes, video_link, zoom_meeting_id",
        )
        .eq(idCol, entityId)
        .order("scheduled_start", { ascending: false, nullsFirst: false })
        .limit(50),

      // Zoom recordings (linked via the join table to either the org or contact)
      supabase
        .from("zoom_meeting_clients")
        .select("zoom_meeting:zoom_meetings(zoom_meeting_id, topic, start_time, duration, status, join_url)")
        .eq(idCol, entityId)
        .limit(50),

      project.owner_team_member_id
        ? supabase
            .from("team_members")
            .select("id, full_name, email, avatar_url")
            .eq("id", project.owner_team_member_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ])

    const allWorkItems = workItemsRes.data || []
    const matchedWorkItems = allWorkItems.filter((w) => projectMatches(project, w))

    const open = matchedWorkItems.filter((w) => !isCompleted(w))
    const completed = matchedWorkItems.filter((w) => isCompleted(w))

    const client = isOrg
      ? orgRes.data
        ? {
            kind: "organization" as const,
            id: orgRes.data.id,
            name: orgRes.data.name || orgRes.data.full_name,
            karbon_key: orgRes.data.karbon_organization_key,
            karbon_url: orgRes.data.karbon_url,
            email: orgRes.data.primary_email,
            phone: orgRes.data.phone,
            industry: orgRes.data.industry,
            entity_type: orgRes.data.entity_type,
            status: orgRes.data.status,
          }
        : null
      : contactRes.data
      ? {
          kind: "contact" as const,
          id: contactRes.data.id,
          name: contactRes.data.full_name,
          karbon_key: contactRes.data.karbon_contact_key,
          karbon_url: contactRes.data.karbon_url,
          email: contactRes.data.primary_email,
          phone: contactRes.data.phone_primary,
          entity_type: contactRes.data.entity_type,
          status: contactRes.data.status,
        }
      : null

    // Pull all proposal services into a flat "related services" list, with the
    // parent proposal context attached. De-duplicate by service_name.
    const proposals = proposalsRes.data || []
    const relatedServices: Array<{
      id: string
      service_name: string
      description: string | null
      billing_frequency: string | null
      billing_type: string | null
      unit_price: number | null
      total_amount: number | null
      currency: string | null
      status: string | null
      start_date: string | null
      end_date: string | null
      proposal_id: string
      proposal_title: string | null
      proposal_status: string | null
    }> = []
    for (const prop of proposals) {
      for (const svc of (prop.services || []) as any[]) {
        relatedServices.push({
          id: svc.id,
          service_name: svc.service_name,
          description: svc.description,
          billing_frequency: svc.billing_frequency,
          billing_type: svc.billing_type,
          unit_price: svc.unit_price,
          total_amount: svc.total_amount,
          currency: svc.currency || prop.currency,
          status: svc.status,
          start_date: svc.start_date,
          end_date: svc.end_date,
          proposal_id: prop.proposal_id,
          proposal_title: prop.title,
          proposal_status: prop.status,
        })
      }
    }

    return NextResponse.json({
      project: {
        ...project,
        owner: ownerRes.data || null,
      },
      client,
      systems: systemsRes.data || [],
      work_items: {
        all: matchedWorkItems,
        open,
        completed,
        total: matchedWorkItems.length,
        open_count: open.length,
        completed_count: completed.length,
      },
      proposals,
      related_services: relatedServices,
      intakes: intakesRes.data || [],
      debriefs: debriefsRes.data || [],
      meetings: meetingsRes.data || [],
      recordings: (recordingsRes.data || []).map((r: any) => r.zoom_meeting).filter(Boolean),
    })
  } catch (err: any) {
    console.error("[v0] /api/projects/[id] GET failed:", err?.message || err)
    return NextResponse.json({ error: "Failed to load project" }, { status: 500 })
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid project id" }, { status: 400 })
    const body = await request.json()

    const allowed = [
      "name",
      "kind",
      "status",
      "description",
      "work_type_pattern",
      "work_template_pattern",
      "start_date",
      "end_date",
      "owner_team_member_id",
    ] as const
    const patch: Record<string, any> = {}
    for (const k of allowed) if (k in body) patch[k] = body[k]

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No updatable fields supplied" }, { status: 400 })
    }

    const supabase = createAdminClient()
    const { data, error } = await supabase.from("projects").update(patch).eq("id", id).select().single()
    if (error) throw error
    return NextResponse.json({ project: data })
  } catch (err: any) {
    console.error("[v0] /api/projects/[id] PATCH failed:", err?.message || err)
    return NextResponse.json({ error: err?.message || "Failed to update project" }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid project id" }, { status: 400 })

    const supabase = createAdminClient()
    const { error } = await supabase.from("projects").delete().eq("id", id)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error("[v0] /api/projects/[id] DELETE failed:", err?.message || err)
    return NextResponse.json({ error: "Failed to delete project" }, { status: 500 })
  }
}
