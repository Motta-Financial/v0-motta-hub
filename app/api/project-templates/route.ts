/**
 * Project Templates catalog.
 *
 * Mirrors the published Karbon work templates — the basis for "start a
 * project from a template". Filterable by type. Returns enough metadata
 * for the picker (estimated time, last used date) plus a usage count
 * across existing Hub projects.
 *
 *   GET /api/project-templates
 *   GET /api/project-templates?typeKey=...
 *   GET /api/project-templates?search=...
 */
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const typeKey = searchParams.get("typeKey")
    const search = (searchParams.get("search") || "").trim()
    const includeInactive = searchParams.get("includeInactive") === "1"

    const supabase = createAdminClient()

    let q = supabase
      .from("work_templates")
      .select(
        "karbon_work_template_key, karbon_work_type_key, title, description, estimated_budget_minutes, estimated_time_minutes, has_scheduled_client_task_groups, published_date, date_modified, number_of_work_items_created, date_last_work_item_created, is_active",
      )
      .order("title", { ascending: true })
      .limit(500)

    if (!includeInactive) q = q.eq("is_active", true)
    if (typeKey) q = q.eq("karbon_work_type_key", typeKey)
    if (search) q = q.ilike("title", `%${search}%`)

    const [tmplRes, typesRes, projRes] = await Promise.all([
      q,
      supabase.from("work_types").select("karbon_work_type_key, name"),
      supabase.from("projects").select("project_template_key").not("project_template_key", "is", null),
    ])
    if (tmplRes.error) throw tmplRes.error
    if (typesRes.error) throw typesRes.error
    if (projRes.error) throw projRes.error

    const typeMap = new Map((typesRes.data || []).map((t) => [t.karbon_work_type_key, t.name]))
    const usage = new Map<string, number>()
    for (const p of projRes.data || []) {
      if (!p.project_template_key) continue
      usage.set(p.project_template_key, (usage.get(p.project_template_key) || 0) + 1)
    }

    const templates = (tmplRes.data || []).map((t) => ({
      key: t.karbon_work_template_key,
      type_key: t.karbon_work_type_key,
      type_name: t.karbon_work_type_key ? typeMap.get(t.karbon_work_type_key) || null : null,
      title: t.title,
      description: t.description,
      estimated_budget_minutes: t.estimated_budget_minutes,
      estimated_time_minutes: t.estimated_time_minutes,
      has_scheduled_client_task_groups: t.has_scheduled_client_task_groups,
      published_date: t.published_date,
      date_modified: t.date_modified,
      karbon_work_items_created: t.number_of_work_items_created || 0,
      date_last_work_item_created: t.date_last_work_item_created,
      is_active: t.is_active,
      hub_project_count: usage.get(t.karbon_work_template_key) || 0,
    }))

    return NextResponse.json({ templates })
  } catch (err: any) {
    console.error("[v0] /api/project-templates GET failed:", err?.message || err)
    return NextResponse.json({ error: "Failed to load project templates" }, { status: 500 })
  }
}
