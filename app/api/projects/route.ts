/**
 * Projects collection endpoint.
 *
 * GET  /api/projects               — list projects (with attached work-item counts)
 * POST /api/projects               — create a new project
 *
 * Listing strategy
 * ----------------
 * The page wants to show a count of attached work items per project. Rather
 * than running N+1 queries we (a) pull the projects in one query, then
 * (b) issue ONE additional query against `work_items` that's filtered by the
 * union of all the projects' clients, and count matches in JavaScript by
 * applying each project's `work_template_pattern` / `work_type_pattern`.
 * This is fast and keeps the API "rules-based" so newly-synced Karbon items
 * show up automatically with no backfill.
 */
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

type Project = {
  id: string
  name: string
  kind: string
  status: string
  description: string | null
  organization_id: string | null
  contact_id: string | null
  work_type_pattern: string | null
  work_template_pattern: string | null
  start_date: string | null
  end_date: string | null
  owner_team_member_id: string | null
  created_at: string
  updated_at: string
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const kind = searchParams.get("kind")
    const status = searchParams.get("status") ?? "active"
    const search = (searchParams.get("search") || "").trim()
    const clientId = searchParams.get("clientId")

    const supabase = createAdminClient()

    const typeKey = searchParams.get("typeKey")
    const templateKey = searchParams.get("templateKey")

    let query = supabase
      .from("projects_enriched")
      .select("*")
      .order("name", { ascending: true })
      .limit(500)

    if (kind) query = query.eq("kind", kind)
    if (typeKey) query = query.eq("project_type_key", typeKey)
    if (templateKey) query = query.eq("project_template_key", templateKey)
    if (status && status !== "all") query = query.eq("status", status)
    if (search) query = query.ilike("name", `%${search}%`)
    if (clientId) query = query.or(`organization_id.eq.${clientId},contact_id.eq.${clientId}`)

    const { data: projects, error } = await query
    if (error) throw error

    // If filtering by clientId, also include projects that have this client
    // as a non-primary `project_clients` row. We do that with a separate
    // query and merge — keeps the main view query simple.
    let extraProjects: any[] = []
    if (clientId) {
      const { data: extraRows } = await supabase
        .from("project_clients")
        .select("project_id")
        .or(`organization_id.eq.${clientId},contact_id.eq.${clientId}`)
        .eq("is_primary", false)
      const extraIds = Array.from(new Set((extraRows || []).map((r) => r.project_id))).filter(
        (pid) => !(projects || []).some((p: any) => p.id === pid),
      )
      if (extraIds.length) {
        const { data: extra } = await supabase
          .from("projects_enriched")
          .select("*")
          .in("id", extraIds)
        extraProjects = extra || []
      }
    }

    const projectList = ([...(projects || []), ...extraProjects]) as (Project & {
      project_type_key: string | null
      project_template_key: string | null
      project_type_name: string | null
      project_template_title: string | null
      clients: Array<{
        id: string
        kind: "organization" | "contact"
        client_id: string
        name: string
        role: string
        is_primary: boolean
        ownership_pct: number | null
        karbon_url: string | null
      }>
    })[]

    // ── Work-item counts per project ──
    // Build the union of client ids across ALL clients (primary + secondary)
    // listed on each project, then issue ONE batched work_items query.
    const orgIds = new Set<string>()
    const contactIds = new Set<string>()
    for (const p of projectList) {
      for (const c of p.clients || []) {
        if (c.kind === "organization") orgIds.add(c.client_id)
        else contactIds.add(c.client_id)
      }
    }
    const allClientIds = [...orgIds, ...contactIds]
    let workItems: any[] = []
    if (allClientIds.length) {
      const inList = allClientIds.map((id) => `"${id}"`).join(",")
      const { data: wi, error: wiErr } = await supabase
        .from("work_items")
        .select(
          "id, karbon_work_item_key, title, work_type, work_template_name, status, primary_status, secondary_status, due_date, organization_id, contact_id, completed_date, deleted_in_karbon_at",
        )
        .or(`organization_id.in.(${inList}),contact_id.in.(${inList})`)
        .is("deleted_in_karbon_at", null)
        .limit(5000)
      if (wiErr) throw wiErr
      workItems = wi || []
    }

    // Group work items by client id for fast lookup.
    const wiByOrg = new Map<string, any[]>()
    const wiByContact = new Map<string, any[]>()
    for (const w of workItems) {
      if (w.organization_id) {
        const arr = wiByOrg.get(w.organization_id) || []
        arr.push(w)
        wiByOrg.set(w.organization_id, arr)
      }
      if (w.contact_id && !w.organization_id) {
        const arr = wiByContact.get(w.contact_id) || []
        arr.push(w)
        wiByContact.set(w.contact_id, arr)
      }
    }

    const enriched = projectList.map((p) => {
      // Aggregate work items across every linked client. We dedupe by id
      // since an item with both org and contact set could otherwise be
      // double-counted.
      const seen = new Set<string>()
      const clientWis: any[] = []
      for (const c of p.clients || []) {
        const arr = c.kind === "organization" ? wiByOrg.get(c.client_id) : wiByContact.get(c.client_id)
        for (const w of arr || []) {
          if (seen.has(w.id)) continue
          seen.add(w.id)
          clientWis.push(w)
        }
      }
      const matched = clientWis.filter((w) => projectMatches(p, w))
      const open = matched.filter((w) => !isCompleted(w))
      const nextDue = open
        .map((w) => w.due_date)
        .filter(Boolean)
        .sort()[0] || null

      const primary = (p.clients || []).find((c) => c.is_primary) || (p.clients || [])[0] || null
      const clientName: string = primary?.name || "Unlinked client"

      return {
        ...p,
        client_name: clientName,
        client_kind: primary?.kind || ("organization" as const),
        client_id: primary?.client_id || null,
        karbon_url: primary?.karbon_url || null,
        client_count: (p.clients || []).length,
        work_item_count: matched.length,
        open_work_item_count: open.length,
        next_due_date: nextDue,
      }
    })

    return NextResponse.json({ projects: enriched, total: enriched.length })
  } catch (err: any) {
    console.error("[v0] /api/projects GET failed:", err?.message || err)
    return NextResponse.json({ error: "Failed to list projects" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()

    if (!body.name || typeof body.name !== "string") {
      return NextResponse.json({ error: "`name` is required" }, { status: 400 })
    }
    if (!body.organization_id && !body.contact_id) {
      return NextResponse.json(
        { error: "Either `organization_id` or `contact_id` is required" },
        { status: 400 },
      )
    }

    const supabase = createAdminClient()
    const insert = {
      name: body.name.trim(),
      kind: body.kind || "custom",
      status: body.status || "active",
      description: body.description || null,
      organization_id: body.organization_id || null,
      contact_id: body.contact_id || null,
      project_type_key: body.project_type_key || null,
      project_template_key: body.project_template_key || null,
      work_type_pattern: body.work_type_pattern || null,
      work_template_pattern: body.work_template_pattern || null,
      start_date: body.start_date || null,
      end_date: body.end_date || null,
      owner_team_member_id: body.owner_team_member_id || null,
    }

    const { data, error } = await supabase.from("projects").insert(insert).select().single()
    if (error) throw error

    // Mirror the primary client into the project_clients join row.
    if (data && (insert.organization_id || insert.contact_id)) {
      await supabase.from("project_clients").insert({
        project_id: data.id,
        organization_id: insert.organization_id,
        contact_id: insert.contact_id,
        role: "primary",
        is_primary: true,
      })
    }

    return NextResponse.json({ project: data }, { status: 201 })
  } catch (err: any) {
    console.error("[v0] /api/projects POST failed:", err?.message || err)
    return NextResponse.json({ error: err?.message || "Failed to create project" }, { status: 500 })
  }
}

// ── helpers (shared with the [id] route via duplication; keep small) ──────
function isCompleted(w: any): boolean {
  const s = String(w.status || w.primary_status || "").toLowerCase()
  return s.includes("complete") || s.includes("cancel") || s.includes("archived")
}

// NOTE: not exported — Next.js route files may only export route handlers
// (GET/POST/etc.) and a fixed set of config fields. Exporting an arbitrary
// helper from a route module fails the build under strict type checking.
function projectMatches(p: Project, w: any): boolean {
  // If the project specifies neither pattern, we treat any work item for this
  // client as a match — useful for free-form "everything for this client"
  // engagement projects.
  if (!p.work_type_pattern && !p.work_template_pattern) return true

  const wt = String(w.work_type || "").toLowerCase()
  const tn = String(w.work_template_name || "").toLowerCase()
  const ttl = String(w.title || "").toLowerCase()

  const matchTemplate = p.work_template_pattern
    ? tn.includes(p.work_template_pattern.toLowerCase()) ||
      ttl.includes(p.work_template_pattern.toLowerCase())
    : true
  const matchType = p.work_type_pattern ? wt.includes(p.work_type_pattern.toLowerCase()) : true

  return matchTemplate && matchType
}
