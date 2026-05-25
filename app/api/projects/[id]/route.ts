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

    // Pull all linked clients (multi-client model) up front. The previous
    // single-client API stays backwards-compatible by returning the row
    // marked is_primary as `client`.
    const { data: pcRows, error: pcErr } = await supabase
      .from("project_clients")
      .select(
        `id, organization_id, contact_id, role, is_primary, ownership_pct, notes,
         organization:organizations (id, name, full_name, karbon_organization_key, karbon_url, primary_email, phone, industry, entity_type, status),
         contact:contacts (id, full_name, primary_email, phone_primary, karbon_contact_key, karbon_url, entity_type, status)`,
      )
      .eq("project_id", id)
      .order("is_primary", { ascending: false })
    if (pcErr) throw pcErr

    const linkedOrgIds = (pcRows || []).map((r: any) => r.organization_id).filter(Boolean) as string[]
    const linkedContactIds = (pcRows || []).map((r: any) => r.contact_id).filter(Boolean) as string[]

    // Resolve project type / template (text keys → human metadata).
    const [typeRes, tmplRes] = await Promise.all([
      project.project_type_key
        ? supabase
            .from("work_types")
            .select("karbon_work_type_key, name, is_recurring, default_budget_minutes")
            .eq("karbon_work_type_key", project.project_type_key)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      project.project_template_key
        ? supabase
            .from("work_templates")
            .select(
              "karbon_work_template_key, title, description, estimated_budget_minutes, estimated_time_minutes, has_scheduled_client_task_groups, published_date",
            )
            .eq("karbon_work_template_key", project.project_template_key)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ])

    // For per-client related lookups we union both organization_id and
    // contact_id ranges. Empty arrays are tolerated by the helpers below.
    const orRangeFor = (col: "organization_id" | "contact_id", ids: string[]) =>
      ids.length ? `${col}.in.(${ids.map((x) => `"${x}"`).join(",")})` : null

    const orgIn = orRangeFor("organization_id", linkedOrgIds)
    const contactIn = orRangeFor("contact_id", linkedContactIds)
    const anyClientFilter = [orgIn, contactIn].filter(Boolean).join(",") || "id.eq.00000000-0000-0000-0000-000000000000"

    const [systemsRes, workItemsRes, proposalsRes, intakesRes, debriefsRes, meetingsRes, recordingsRes, ownerRes] = await Promise.all([
      supabase
        .from("project_systems")
        .select("*")
        .eq("project_id", id)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),

      supabase
        .from("work_items")
        .select(
          "id, karbon_work_item_key, title, work_type, work_template_name, status, primary_status, secondary_status, workflow_status, assignee_name, due_date, start_date, completed_date, period_start, period_end, karbon_url, priority, todo_count, completed_todo_count, has_blocking_todos, karbon_modified_at, deleted_in_karbon_at, organization_id, contact_id",
        )
        .or(anyClientFilter)
        .is("deleted_in_karbon_at", null)
        .order("start_date", { ascending: false, nullsFirst: false })
        .limit(1000),

      supabase
        .from("ignition_proposals")
        .select(
          `proposal_id, proposal_number, title, status, total_value, recurring_total, recurring_frequency, currency, sent_at, accepted_at, completed_at, lost_at, signed_url, organization_id, contact_id,
           services:ignition_proposal_services (
             id, service_name, description, quantity, unit_price, total_amount, currency, billing_frequency, billing_type, status, start_date, end_date
           )`,
        )
        .or(anyClientFilter)
        .order("accepted_at", { ascending: false, nullsFirst: false })
        .limit(50),

      supabase
        .from("jotform_intake_submissions")
        .select(
          "id, jotform_submission_id, jotform_created_at, submitter_full_name, submitter_email, business_name, service_focus, services_requested, lead_status, link_method, karbon_work_item_url, organization_id, contact_id",
        )
        .or(anyClientFilter)
        .order("jotform_created_at", { ascending: false, nullsFirst: false })
        .limit(50),

      supabase
        .from("debriefs_full")
        .select(
          "id, debrief_date, debrief_type, status, follow_up_date, tax_year, notes, action_items, work_item_id, work_item_title, work_item_karbon_url, team_member_full_name, created_at, organization_id, contact_id",
        )
        .or(anyClientFilter)
        .order("debrief_date", { ascending: false, nullsFirst: false })
        .limit(100),

      supabase
        .from("meetings")
        .select(
          "id, title, meeting_type, status, scheduled_start, scheduled_end, duration_minutes, video_link, zoom_meeting_id, organization_id, contact_id",
        )
        .or(anyClientFilter)
        .order("scheduled_start", { ascending: false, nullsFirst: false })
        .limit(100),

      supabase
        .from("zoom_meeting_clients")
        .select("organization_id, contact_id, zoom_meeting:zoom_meetings(zoom_meeting_id, topic, start_time, duration, status, join_url)")
        .or(anyClientFilter)
        .limit(100),

      project.owner_team_member_id
        ? supabase
            .from("team_members")
            .select("id, full_name, email, avatar_url")
            .eq("id", project.owner_team_member_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ])

    // Dedupe items that match more than one linked client (e.g. a meeting
    // linked to both an org and its officer contact).
    function dedupe<T extends Record<string, any>>(rows: T[]): T[] {
      const seen = new Set<any>()
      const out: T[] = []
      for (const r of rows) {
        const k = (r as any).id ?? (r as any).zoom_meeting_id
        if (k != null && seen.has(k)) continue
        if (k != null) seen.add(k)
        out.push(r)
      }
      return out
    }

    const allWorkItems = dedupe(workItemsRes.data || [])
    const matchedWorkItems = allWorkItems.filter((w) => projectMatches(project, w))

    const open = matchedWorkItems.filter((w) => !isCompleted(w))
    const completed = matchedWorkItems.filter((w) => isCompleted(w))

    // Build clients list (multi). The legacy `client` field returns the row
    // marked is_primary so existing UI keeps rendering correctly.
    const clients = (pcRows || []).map((row: any) => {
      const isOrgRow = !!row.organization_id
      const o = row.organization
      const c = row.contact
      return {
        link_id: row.id,
        kind: isOrgRow ? ("organization" as const) : ("contact" as const),
        id: isOrgRow ? o?.id : c?.id,
        role: row.role,
        is_primary: row.is_primary,
        ownership_pct: row.ownership_pct,
        notes: row.notes,
        name: isOrgRow ? o?.name || o?.full_name : c?.full_name,
        karbon_key: isOrgRow ? o?.karbon_organization_key : c?.karbon_contact_key,
        karbon_url: isOrgRow ? o?.karbon_url : c?.karbon_url,
        email: isOrgRow ? o?.primary_email : c?.primary_email,
        phone: isOrgRow ? o?.phone : c?.phone_primary,
        industry: isOrgRow ? o?.industry : null,
        entity_type: (isOrgRow ? o?.entity_type : c?.entity_type) || null,
        status: isOrgRow ? o?.status : c?.status,
      }
    })

    const primary = clients.find((c) => c.is_primary) || clients[0] || null
    const client = primary
      ? {
          kind: primary.kind,
          id: primary.id,
          name: primary.name,
          karbon_key: primary.karbon_key,
          karbon_url: primary.karbon_url,
          email: primary.email,
          phone: primary.phone,
          industry: primary.industry,
          entity_type: primary.entity_type,
          status: primary.status,
        }
      : null

    // Pull all proposal services into a flat "related services" list, with the
    // parent proposal context attached.
    const proposals = dedupe(proposalsRes.data || [])
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
      for (const svc of ((prop as any).services || []) as any[]) {
        relatedServices.push({
          id: svc.id,
          service_name: svc.service_name,
          description: svc.description,
          billing_frequency: svc.billing_frequency,
          billing_type: svc.billing_type,
          unit_price: svc.unit_price,
          total_amount: svc.total_amount,
          currency: svc.currency || (prop as any).currency,
          status: svc.status,
          start_date: svc.start_date,
          end_date: svc.end_date,
          proposal_id: (prop as any).proposal_id,
          proposal_title: (prop as any).title,
          proposal_status: (prop as any).status,
        })
      }
    }

    return NextResponse.json({
      project: {
        ...project,
        owner: ownerRes.data || null,
        project_type: typeRes.data || null,
        project_template: tmplRes.data || null,
      },
      client,
      clients,
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
      intakes: dedupe(intakesRes.data || []),
      debriefs: dedupe(debriefsRes.data || []),
      meetings: dedupe(meetingsRes.data || []),
      recordings: (() => {
        const m = new Map<any, any>()
        for (const r of (recordingsRes.data || []) as any[]) {
          const meeting = r.zoom_meeting
          if (!meeting?.zoom_meeting_id) continue
          if (!m.has(meeting.zoom_meeting_id)) m.set(meeting.zoom_meeting_id, meeting)
        }
        return Array.from(m.values())
      })(),
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
      "project_type_key",
      "project_template_key",
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
