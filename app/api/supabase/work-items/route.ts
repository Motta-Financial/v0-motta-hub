import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

// Columns are kept in sync with the `KarbonWorkItem` shape consumed by
// the Project Plan / Bookkeeping / Onboarding / Tax dashboards. If a
// downstream component starts reading a new field, add it here too so
// the API response stays a drop-in replacement for /api/work-items.
const SELECT_COLUMNS = `
  id,
  karbon_work_item_key,
  title,
  description,
  status,
  primary_status,
  secondary_status,
  workflow_status,
  work_type,
  priority,
  due_date,
  start_date,
  completed_date,
  period_start,
  period_end,
  tax_year,
  client_type,
  client_name,
  karbon_client_key,
  client_group_name,
  client_manager_name,
  client_partner_name,
  assignee_name,
  estimated_minutes,
  actual_minutes,
  budget_minutes,
  karbon_url,
  karbon_created_at,
  karbon_modified_at,
  deleted_in_karbon_at,
  contact_id,
  organization_id,
  client_group_id
`

// PostgREST caps any single response at 1000 rows regardless of the
// requested limit/range. We paginate server-side in chunks of this size
// when the caller asks for more (the Accounting Project Plan needs
// ~1,037 ACCT items, for example).
const PG_MAX_CHUNK = 1000

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)

    // Get filter parameters
    const serviceLine = searchParams.get("serviceLine")
    const titleFilter = searchParams.get("titleFilter")
    // work_type filtering — much more accurate than title-matching because Karbon
    // populates work_type consistently (e.g. "ACCT | Bookkeeping") even when titles
    // vary across years/clients (e.g. "BKPG | Bookkeeping | Acme | Jan 2025").
    const workType = searchParams.get("workType") // exact match, e.g. "ACCT | Bookkeeping"
    const workTypePrefix = searchParams.get("workTypePrefix") // starts-with, e.g. "ACCT | "
    // Comma-separated allow-list of exact work_type values, e.g.
    // "ACCT | Onboarding (BKPG),ACCT | Onboarding (PYRL)". Use this when
    // a tracker needs to surface a curated subset of work_types — it's
    // strictly more accurate than `workTypePrefix` because it can't pick
    // up new untriaged Karbon work types that happen to match the prefix.
    const workTypesParam = searchParams.get("workTypes")
    const status = searchParams.get("status")
    const periodMonth = searchParams.get("periodMonth") // Format: "2024-01" for January 2024
    const periodYear = searchParams.get("periodYear")

    // Per-route override (?includeDeleted=true) is supported for audit views;
    // every other call gets a clean "live in Karbon" feed by default.
    const includeDeleted = searchParams.get("includeDeleted") === "true"
    const search = searchParams.get("search") || searchParams.get("q")

    // Optional caller-supplied limit. Default 500 preserves historical
    // behavior for the existing dashboards (small/fast). Capped at 5000
    // so a runaway query can't pull the entire `work_items` table. When
    // `limit > 1000` we loop in `PG_MAX_CHUNK`-sized chunks below.
    const requestedLimit = Math.min(
      Math.max(Number.parseInt(searchParams.get("limit") || "500", 10) || 500, 1),
      5000,
    )

    // Build a fresh PostgREST query every chunk. The Supabase JS client's
    // builder is mutable (chaining mutates `this`) and re-awaiting a
    // builder after a network call has subtle gotchas across versions —
    // rebuilding from scratch removes all ambiguity.
    const buildQuery = () => {
      let query = supabase
        .from("work_items")
        .select(SELECT_COLUMNS)
        .order("karbon_modified_at", { ascending: false })

      if (!includeDeleted) {
        query = query.is("deleted_in_karbon_at", null)
      }

      if (search && search.trim().length >= 3) {
        // Hit the GIN-indexed search_vector for fast multi-column text search.
        query = query.textSearch("search_vector", search.trim(), {
          type: "websearch",
          config: "simple",
        })
      } else if (search && search.trim()) {
        const t = search.trim()
        query = query.or(`title.ilike.%${t}%,karbon_work_item_key.ilike.%${t}%`)
      }

      if (workType) {
        // Exact match (case-insensitive) on work_type — preferred for the
        // Accounting / Tax / Payroll dashboards because it's the canonical
        // categorization Karbon ships with each work item.
        query = query.ilike("work_type", workType)
      } else if (workTypesParam) {
        // Allow-list filter. Splits and trims the comma-separated input,
        // drops any empty values (which would otherwise become `IN ('')`
        // and silently exclude every row), and uses Postgres `IN (...)`.
        const list = workTypesParam
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
        if (list.length > 0) {
          query = query.in("work_type", list)
        }
      } else if (workTypePrefix) {
        // Starts-with match for grouping multiple work types under one umbrella
        // (e.g. all "ACCT | *" rows for the Accounting overview).
        // Escape `%` and `_` so user-supplied prefixes can't break the LIKE pattern.
        const escaped = workTypePrefix.replace(/([%_\\])/g, "\\$1")
        query = query.ilike("work_type", `${escaped}%`)
      }

      if (titleFilter) {
        query = query.ilike("title", `%${titleFilter}%`)
      }

      if (status === "active" || !status) {
        // Default: exclude completed and cancelled work items from dashboard views
        query = query.not("status", "ilike", "%completed%").not("status", "ilike", "%cancelled%")
      } else if (status === "all") {
        // Explicitly request all statuses (for search)
      } else if (status) {
        query = query.ilike("status", `%${status}%`)
      }

      if (periodMonth && periodYear) {
        const monthNum = Number.parseInt(periodMonth)
        const yearNum = Number.parseInt(periodYear)
        // Create date range for the month
        const startOfMonth = new Date(yearNum, monthNum - 1, 1).toISOString().split("T")[0]
        const endOfMonth = new Date(yearNum, monthNum, 0).toISOString().split("T")[0]

        query = query.gte("period_start", startOfMonth).lte("period_start", endOfMonth)
      } else if (periodYear) {
        // Filter by year only
        query = query.eq("tax_year", Number.parseInt(periodYear))
      }

      return query
    }

    type WorkItemRow = {
      id: string
      contact_id: string | null
      organization_id: string | null
      client_group_name: string | null
      [key: string]: unknown
    }

    const workItems: WorkItemRow[] = []
    let offset = 0
    while (workItems.length < requestedLimit) {
      const remaining = requestedLimit - workItems.length
      const chunkSize = Math.min(remaining, PG_MAX_CHUNK)
      const { data: chunk, error: chunkError } = await buildQuery().range(
        offset,
        offset + chunkSize - 1,
      )
      if (chunkError) {
        console.error("[v0] Supabase work_items error:", chunkError)
        return NextResponse.json({ error: chunkError.message }, { status: 500 })
      }
      if (!chunk || chunk.length === 0) break
      for (const row of chunk as WorkItemRow[]) workItems.push(row)
      // Short reads mean we've exhausted the filtered result set — stop.
      if (chunk.length < chunkSize) break
      offset += chunkSize
    }

    // Get related client info if needed
    const contactIds = [
      ...new Set(workItems.filter((w) => w.contact_id).map((w) => w.contact_id as string)),
    ]
    const orgIds = [
      ...new Set(workItems.filter((w) => w.organization_id).map((w) => w.organization_id as string)),
    ]

    let contacts: any[] = []
    let organizations: any[] = []

    if (contactIds.length > 0) {
      const { data } = await supabase
        .from("contacts")
        .select("id, full_name, primary_email, avatar_url, karbon_contact_key")
        .in("id", contactIds)
      contacts = data || []
    }

    if (orgIds.length > 0) {
      const { data } = await supabase
        .from("organizations")
        .select("id, name, primary_email, karbon_organization_key")
        .in("id", orgIds)
      organizations = data || []
    }

    // Create lookup maps
    const contactMap = new Map(contacts.map((c) => [c.id, c]))
    const orgMap = new Map(organizations.map((o) => [o.id, o]))

    // Enrich work items with client info
    const enrichedWorkItems = workItems.map((item) => ({
      ...item,
      client: item.contact_id
        ? contactMap.get(item.contact_id)
        : item.organization_id
          ? orgMap.get(item.organization_id)
          : null,
      clientName: item.contact_id
        ? contactMap.get(item.contact_id)?.full_name
        : item.organization_id
          ? orgMap.get(item.organization_id)?.name
          : item.client_group_name || "Unknown Client",
    }))

    return NextResponse.json({
      workItems: enrichedWorkItems,
      total: enrichedWorkItems.length,
    })
  } catch (error) {
    console.error("[v0] Work items API error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch work items" },
      { status: 500 },
    )
  }
}
