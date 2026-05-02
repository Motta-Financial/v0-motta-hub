import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import {
  loadRecurringScrubSet,
  normalizeClientName,
} from "@/lib/sales/recurring-scrub"

/**
 * Sales > Proposals listing endpoint.
 *
 * Returns paginated, filterable Ignition proposals with their linked
 * organization name (for the client column). Designed to back a server-paged
 * table — keep response shape stable for SWR pagination.
 */

export const dynamic = "force-dynamic"

const PAGE_SIZE_DEFAULT = 50
const PAGE_SIZE_MAX = 200

export async function GET(req: Request) {
  const url = new URL(req.url)
  const sp = url.searchParams

  const page = Math.max(1, Number.parseInt(sp.get("page") || "1", 10))
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, Number.parseInt(sp.get("pageSize") || String(PAGE_SIZE_DEFAULT), 10)),
  )
  const status = sp.get("status") || ""
  const search = (sp.get("search") || "").trim()
  const partner = sp.get("partner") || ""
  const manager = sp.get("manager") || ""
  const sentBy = sp.get("sentBy") || ""
  const minValue = sp.get("minValue") ? Number(sp.get("minValue")) : null
  const maxValue = sp.get("maxValue") ? Number(sp.get("maxValue")) : null
  const dateField = (sp.get("dateField") || "created_at") as
    | "created_at"
    | "accepted_at"
    | "sent_at"
    | "completed_at"
  const dateFrom = sp.get("dateFrom") || ""
  const dateTo = sp.get("dateTo") || ""
  const sortBy = sp.get("sortBy") || "created_at"
  const sortDir = (sp.get("sortDir") || "desc") as "asc" | "desc"

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  let query = supabase
    .from("ignition_proposals")
    .select(
      `proposal_id, proposal_number, title, status, total_value, one_time_total,
       recurring_total, recurring_frequency, currency, client_name, client_email,
       client_partner, client_manager, proposal_sent_by, billing_starts_on,
       sent_at, accepted_at, completed_at, lost_at, lost_reason, created_at, updated_at,
       organization_id, organizations(id, name)`,
      { count: "exact" },
    )
    .is("archived_at", null)

  // Filters
  if (status) {
    const list = status.split(",").filter(Boolean)
    if (list.length > 0) query = query.in("status", list)
  }
  if (partner) {
    const list = partner.split(",").filter(Boolean)
    if (list.length > 0) query = query.in("client_partner", list)
  }
  if (manager) {
    const list = manager.split(",").filter(Boolean)
    if (list.length > 0) query = query.in("client_manager", list)
  }
  if (sentBy) {
    const list = sentBy.split(",").filter(Boolean)
    if (list.length > 0) query = query.in("proposal_sent_by", list)
  }
  if (minValue !== null && !Number.isNaN(minValue)) {
    query = query.gte("total_value", minValue)
  }
  if (maxValue !== null && !Number.isNaN(maxValue)) {
    query = query.lte("total_value", maxValue)
  }
  if (dateFrom) query = query.gte(dateField, dateFrom)
  if (dateTo) query = query.lte(dateField, dateTo)
  if (search) {
    const safe = search.replace(/[%,]/g, "")
    query = query.or(
      `client_name.ilike.%${safe}%,title.ilike.%${safe}%,proposal_number.ilike.%${safe}%,client_email.ilike.%${safe}%`,
    )
  }

  // Sort + paginate
  const validSortFields = new Set([
    "created_at",
    "accepted_at",
    "sent_at",
    "completed_at",
    "total_value",
    "client_name",
    "status",
    "proposal_number",
  ])
  const finalSort = validSortFields.has(sortBy) ? sortBy : "created_at"
  query = query.order(finalSort, { ascending: sortDir === "asc", nullsFirst: false })

  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  query = query.range(from, to)

  const { data, error, count } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Apply curated recurring-revenue scrub: only proposals whose linked
  // organization OR client_name appears in `motta_recurring_revenue` keep
  // their recurring_total. Everyone else has it shifted into one-time so
  // the table doesn't lie about what's actually recurring.
  const curatedRecurring = await loadRecurringScrubSet()
  const scrubbed = (data || []).map((p: any) => {
    const candidates = [p.organizations?.name, p.client_name].filter(
      Boolean,
    ) as string[]
    const isCurated = candidates.some((n) =>
      curatedRecurring.has(normalizeClientName(n)),
    )
    if (isCurated) {
      return { ...p, is_curated_recurring: true }
    }
    const recurring = Number(p.recurring_total) || 0
    const oneTime = Number(p.one_time_total) || 0
    const total = Number(p.total_value) || 0
    return {
      ...p,
      recurring_total: 0,
      recurring_frequency: null,
      one_time_total: Math.max(oneTime + recurring, total > 0 ? total : 0),
      is_curated_recurring: false,
    }
  })

  // Filter dimensions for the UI (cheap separate query, not paginated)
  const { data: dimensionsData } = await supabase
    .from("ignition_proposals")
    .select("status, client_partner, client_manager, proposal_sent_by")
    .is("archived_at", null)

  const dimensions = {
    statuses: uniqueSorted(dimensionsData?.map((d) => d.status)),
    partners: uniqueSorted(dimensionsData?.map((d) => d.client_partner)),
    managers: uniqueSorted(dimensionsData?.map((d) => d.client_manager)),
    sentBy: uniqueSorted(dimensionsData?.map((d) => d.proposal_sent_by)),
  }

  return NextResponse.json({
    proposals: scrubbed,
    page,
    pageSize,
    total: count || 0,
    dimensions,
  })
}

function uniqueSorted(arr: (string | null | undefined)[] | undefined): string[] {
  if (!arr) return []
  const set = new Set<string>()
  for (const v of arr) {
    if (v && typeof v === "string") set.add(v)
  }
  return Array.from(set).sort()
}
