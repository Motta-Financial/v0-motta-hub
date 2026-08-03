/**
 * Project Types catalog.
 *
 * Returns the firm-wide Karbon work types that we use as Project Types,
 * each annotated with a count of published Karbon templates and existing
 * Hub projects. Sorted by name with the inactive ones last.
 *
 *   GET /api/project-types
 */
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const supabase = createAdminClient()

    const [typesRes, tmplCountsRes, projCountsRes] = await Promise.all([
      supabase
        .from("work_types")
        .select("karbon_work_type_key, name, is_recurring, is_active, default_budget_minutes")
        .order("name", { ascending: true }),
      supabase
        .from("work_templates")
        .select("karbon_work_type_key, is_active")
        .limit(2000),
      supabase
        .from("projects")
        .select("project_type_key, status")
        .limit(5000),
    ])

    if (typesRes.error) throw typesRes.error
    if (tmplCountsRes.error) throw tmplCountsRes.error
    if (projCountsRes.error) throw projCountsRes.error

    const tmplCount = new Map<string, number>()
    for (const t of tmplCountsRes.data || []) {
      if (!t.is_active || !t.karbon_work_type_key) continue
      tmplCount.set(t.karbon_work_type_key, (tmplCount.get(t.karbon_work_type_key) || 0) + 1)
    }
    const projCount = new Map<string, { active: number; total: number }>()
    for (const p of projCountsRes.data || []) {
      if (!p.project_type_key) continue
      const cur = projCount.get(p.project_type_key) || { active: 0, total: 0 }
      cur.total += 1
      if (p.status === "active") cur.active += 1
      projCount.set(p.project_type_key, cur)
    }

    const types = (typesRes.data || []).map((t) => ({
      key: t.karbon_work_type_key,
      name: t.name,
      is_active: !!t.is_active,
      is_recurring: !!t.is_recurring,
      default_budget_minutes: t.default_budget_minutes,
      template_count: tmplCount.get(t.karbon_work_type_key) || 0,
      project_count: projCount.get(t.karbon_work_type_key)?.total || 0,
      active_project_count: projCount.get(t.karbon_work_type_key)?.active || 0,
    }))

    return NextResponse.json({ types })
  } catch (err: any) {
    console.error("[v0] /api/project-types GET failed:", err?.message || err)
    return NextResponse.json({ error: "Failed to load project types" }, { status: 500 })
  }
}
