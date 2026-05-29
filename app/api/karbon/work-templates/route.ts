/**
 * GET /api/karbon/work-templates
 *
 * Returns the firm's active Karbon work templates for the "Create Karbon
 * Work Item" dropdown on the prospect form. Read-only and auth-gated —
 * reads from the locally synced `work_templates` table (populated by
 * `lib/karbon/sync-tenant-config.ts`) rather than hitting Karbon live,
 * so the picker is instant and resilient to Karbon downtime.
 *
 * Response shape:
 *   {
 *     templates: Array<{
 *       key: string,            // WorkTemplateKey
 *       title: string,
 *       workTypeKey: string | null,
 *       estimatedBudgetMinutes: number | null
 *     }>,
 *     statuses: Array<{
 *       key: string,            // WorkStatusKey
 *       primary: string | null,
 *       secondary: string | null,
 *       label: string,
 *       workTypeKeys: string[]  // which work types this status applies to
 *     }>
 *   }
 *
 * Statuses are returned alongside so the form can offer a primary/
 * secondary status picker filtered to the chosen template's work type.
 */
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers"

export const runtime = "nodejs"

export async function GET() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await getAuthenticatedUser(supabase)
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const [templatesRes, statusesRes] = await Promise.all([
    supabase
      .from("work_templates")
      .select("karbon_work_template_key, karbon_work_type_key, title, estimated_budget_minutes")
      .eq("is_active", true)
      .order("title", { ascending: true }),
    supabase
      .from("work_status")
      .select("karbon_status_key, name, primary_status_name, secondary_status_name, work_type_keys, display_order")
      .eq("is_active", true)
      .order("display_order", { ascending: true }),
  ])

  if (templatesRes.error) {
    return NextResponse.json({ error: templatesRes.error.message }, { status: 500 })
  }
  if (statusesRes.error) {
    return NextResponse.json({ error: statusesRes.error.message }, { status: 500 })
  }

  const templates = (templatesRes.data ?? []).map((t) => ({
    key: t.karbon_work_template_key as string,
    title: (t.title as string) || "(untitled template)",
    workTypeKey: (t.karbon_work_type_key as string) || null,
    estimatedBudgetMinutes: (t.estimated_budget_minutes as number) ?? null,
  }))

  const statuses = (statusesRes.data ?? []).map((s) => {
    const primary = (s.primary_status_name as string) || null
    const secondary = (s.secondary_status_name as string) || null
    const label =
      primary && secondary
        ? `${primary} — ${secondary}`
        : primary || secondary || (s.name as string) || "(status)"
    let workTypeKeys: string[] = []
    const raw = s.work_type_keys as unknown
    if (Array.isArray(raw)) workTypeKeys = raw.map((k) => String(k))
    return {
      key: s.karbon_status_key as string,
      primary,
      secondary,
      label,
      workTypeKeys,
    }
  })

  return NextResponse.json({ templates, statuses })
}
