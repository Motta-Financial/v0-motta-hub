import { requirePortalAuth } from "@/lib/portal/require-portal-auth"
import { createClient } from "@/lib/supabase/server"
import { applyPortalEntityFilter } from "@/lib/portal/entity-filter"
import { NextResponse } from "next/server"

/**
 * GET /api/client-portal/tax
 * Returns:
 *  - taxWorkItems: open Karbon work items whose type includes "Tax"
 *  - taxReturns: ProConnect returns linked to this client (via master_client_mapping)
 */
export async function GET() {
  const auth = await requirePortalAuth()
  if (!auth.ok) return auth.response

  const { portalUser } = auth
  const supabase = await createClient()

  // ── Tax-specific Karbon work items ──────────────────────────────────────────
  const workItemsQuery = supabase
    .from("work_items")
    .select(`
      id, title, work_type_name, status,
      assignee_name, due_date,
      completed_todo_count, todo_count, has_blocking_todos,
      start_date, created_at
    `)
    .ilike("work_type_name", "%tax%")
    .order("due_date", { ascending: true, nullsFirst: false })

  const { data: rawWorkItems } = await applyPortalEntityFilter(workItemsQuery, portalUser)

  const taxWorkItems = (rawWorkItems ?? []).map((w) => ({
    ...w,
    statusDisplay: mapTaxStatus(w.status),
    progressPct:
      w.todo_count > 0
        ? Math.round((w.completed_todo_count / w.todo_count) * 100)
        : 0,
  }))

  // ── ProConnect tax returns ──────────────────────────────────────────────────
  // Resolve ProConnect client ids via master_client_mapping. internal_client_id
  // is the same uuid as contacts.id / organizations.id, so we can match it
  // directly against every entity this portal login has access to.
  const entityIds = [...portalUser.contactIds, ...portalUser.organizationIds]

  let taxReturns: unknown[] = []

  if (entityIds.length > 0) {
    const { data: mappings } = await supabase
      .from("master_client_mapping")
      .select("proconnect_client_ids")
      .in("internal_client_id", entityIds)

    const proconnectClientIds = Array.from(
      new Set(
        (mappings ?? []).flatMap((m) => (m.proconnect_client_ids as string[] | null) ?? []),
      ),
    )

    if (proconnectClientIds.length > 0) {
      const { data: returns } = await supabase
        .from("proconnect_tax_returns")
        .select(`
          id, tax_year, form_type, status,
          description, last_updated_at, assigned_user_name
        `)
        .in("proconnect_client_id", proconnectClientIds)
        .order("tax_year", { ascending: false })

      taxReturns = (returns ?? []).map((r) => ({
        ...r,
        statusDisplay: mapReturnStatus(r.status),
      }))
    }
  }

  return NextResponse.json({ taxWorkItems, taxReturns })
}

function mapTaxStatus(status: string | null) {
  const s = (status ?? "").toLowerCase()
  if (s.includes("complete") || s.includes("filed"))
    return { label: "Filed", color: "#16a34a" }
  if (s.includes("review") || s.includes("partner"))
    return { label: "Under Review", color: "#7c3aed" }
  if (s.includes("waiting") || s.includes("info") || s.includes("block"))
    return { label: "Waiting on You", color: "#d97706" }
  if (s.includes("progress") || s.includes("started"))
    return { label: "In Progress", color: "#2563eb" }
  return { label: "In Progress", color: "#2563eb" }
}

function mapReturnStatus(status: string | null) {
  const s = (status ?? "").toLowerCase()
  if (s.includes("accept") || s.includes("filed") || s.includes("complete"))
    return { label: "Filed", color: "#16a34a" }
  if (s.includes("review"))  return { label: "Under Review", color: "#7c3aed" }
  if (s.includes("reject"))  return { label: "Rejected", color: "#dc2626" }
  if (s.includes("sent") || s.includes("transmit")) return { label: "Transmitted", color: "#2563eb" }
  if (s.includes("signed"))  return { label: "Signed", color: "#0891b2" }
  if (s.includes("ready"))   return { label: "Ready to File", color: "#0891b2" }
  return { label: status ?? "In Progress", color: "#6b7280" }
}
