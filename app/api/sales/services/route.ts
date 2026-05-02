import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

/**
 * Sales > Services catalog endpoint.
 *
 * Joins the Ignition service catalog (`ignition_services`) with usage counts
 * from `ignition_proposal_services`. Returns one row per catalog service with
 * computed metrics: how many proposals it appears on, total accepted revenue,
 * average price, and currency.
 *
 * Volumes are tiny (~158 services, ~440 service lines) so we aggregate
 * client-side after a single round-trip per table.
 */

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const sp = url.searchParams

  const search = (sp.get("search") || "").trim().toLowerCase()
  const category = sp.get("category") || ""
  const billingType = sp.get("billingType") || ""
  const activeOnly = sp.get("activeOnly") === "true"
  const sortBy = sp.get("sortBy") || "totalRevenue"
  const sortDir = (sp.get("sortDir") || "desc") as "asc" | "desc"

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const [servicesRes, lineItemsRes, proposalsRes] = await Promise.all([
    supabase
      .from("ignition_services")
      .select(
        "ignition_service_id, name, description, category, billing_type, default_price, currency, is_active, created_at, updated_at",
      ),
    supabase
      .from("ignition_proposal_services")
      .select(
        "ignition_service_id, service_name, proposal_id, quantity, unit_price, total_amount, currency, billing_frequency, status",
      ),
    supabase.from("ignition_proposals").select("proposal_id, status").is("archived_at", null),
  ])

  if (servicesRes.error) {
    return NextResponse.json({ error: servicesRes.error.message }, { status: 500 })
  }

  const proposalStatusById = new Map<string, string | null>()
  for (const p of proposalsRes.data || []) {
    proposalStatusById.set(p.proposal_id, p.status)
  }
  const isAccepted = (s: string | null | undefined) =>
    s === "accepted" || s === "completed"

  // Aggregate line items by service id (or service name as fallback for legacy
  // rows that don't have an ignition_service_id).
  type Agg = {
    proposalCount: number
    acceptedCount: number
    lostCount: number
    totalRevenue: number
    acceptedRevenue: number
    units: number
    sumPrice: number
    pricePoints: number
    currency: string | null
    billingFrequencies: Set<string>
  }
  const aggByKey = new Map<string, Agg>()
  const seenProposalsByKey = new Map<string, Set<string>>()

  for (const li of lineItemsRes.data || []) {
    const key = li.ignition_service_id || `name:${(li.service_name || "").toLowerCase()}`
    if (!aggByKey.has(key)) {
      aggByKey.set(key, {
        proposalCount: 0,
        acceptedCount: 0,
        lostCount: 0,
        totalRevenue: 0,
        acceptedRevenue: 0,
        units: 0,
        sumPrice: 0,
        pricePoints: 0,
        currency: null,
        billingFrequencies: new Set(),
      })
      seenProposalsByKey.set(key, new Set())
    }
    const agg = aggByKey.get(key)!
    const seen = seenProposalsByKey.get(key)!
    const proposalStatus = li.proposal_id ? proposalStatusById.get(li.proposal_id) : null
    const total = Number(li.total_amount) || 0
    const unitPrice = Number(li.unit_price) || 0
    if (li.proposal_id && !seen.has(li.proposal_id)) {
      seen.add(li.proposal_id)
      agg.proposalCount += 1
      if (isAccepted(proposalStatus)) agg.acceptedCount += 1
      if (proposalStatus === "lost") agg.lostCount += 1
    }
    agg.totalRevenue += total
    if (isAccepted(proposalStatus)) agg.acceptedRevenue += total
    agg.units += Number(li.quantity) || 0
    if (unitPrice > 0) {
      agg.sumPrice += unitPrice
      agg.pricePoints += 1
    }
    if (li.currency) agg.currency = li.currency
    if (li.billing_frequency) agg.billingFrequencies.add(li.billing_frequency)
  }

  const services = (servicesRes.data || []).map((s) => {
    const key = s.ignition_service_id
    const fallbackKey = `name:${(s.name || "").toLowerCase()}`
    const agg = aggByKey.get(key) || aggByKey.get(fallbackKey)
    const avgPrice = agg && agg.pricePoints > 0 ? agg.sumPrice / agg.pricePoints : null
    return {
      ignition_service_id: s.ignition_service_id,
      name: s.name,
      description: s.description,
      category: s.category,
      billing_type: s.billing_type,
      default_price: s.default_price !== null ? Number(s.default_price) : null,
      currency: agg?.currency || s.currency || "USD",
      is_active: s.is_active,
      created_at: s.created_at,
      updated_at: s.updated_at,
      proposalCount: agg?.proposalCount || 0,
      acceptedCount: agg?.acceptedCount || 0,
      lostCount: agg?.lostCount || 0,
      totalRevenue: agg?.totalRevenue || 0,
      acceptedRevenue: agg?.acceptedRevenue || 0,
      units: agg?.units || 0,
      avgPrice,
      billingFrequencies: agg ? Array.from(agg.billingFrequencies).sort() : [],
    }
  })

  // Filter
  let filtered = services
  if (search) {
    filtered = filtered.filter(
      (s) =>
        (s.name || "").toLowerCase().includes(search) ||
        (s.description || "").toLowerCase().includes(search) ||
        (s.category || "").toLowerCase().includes(search),
    )
  }
  if (category) {
    const list = category.split(",").filter(Boolean)
    filtered = filtered.filter((s) => s.category && list.includes(s.category))
  }
  if (billingType) {
    const list = billingType.split(",").filter(Boolean)
    filtered = filtered.filter((s) => s.billing_type && list.includes(s.billing_type))
  }
  if (activeOnly) {
    filtered = filtered.filter((s) => s.is_active)
  }

  // Sort
  const validSorts = new Set([
    "name",
    "category",
    "totalRevenue",
    "acceptedRevenue",
    "proposalCount",
    "acceptedCount",
    "default_price",
    "avgPrice",
  ])
  const finalSort = validSorts.has(sortBy) ? sortBy : "totalRevenue"
  filtered.sort((a: any, b: any) => {
    const av = a[finalSort]
    const bv = b[finalSort]
    if (av === bv) return 0
    if (av === null || av === undefined) return 1
    if (bv === null || bv === undefined) return -1
    if (typeof av === "string") {
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av)
    }
    return sortDir === "asc" ? av - bv : bv - av
  })

  // Dimensions for filter chips
  const dimensions = {
    categories: uniqueSorted(services.map((s) => s.category)),
    billingTypes: uniqueSorted(services.map((s) => s.billing_type)),
  }

  // Aggregate KPIs
  const stats = {
    totalServices: services.length,
    activeServices: services.filter((s) => s.is_active).length,
    totalRevenue: services.reduce((sum, s) => sum + s.totalRevenue, 0),
    acceptedRevenue: services.reduce((sum, s) => sum + s.acceptedRevenue, 0),
    totalProposalLines: lineItemsRes.data?.length || 0,
  }

  return NextResponse.json({ services: filtered, dimensions, stats })
}

function uniqueSorted(arr: (string | null | undefined)[]): string[] {
  const set = new Set<string>()
  for (const v of arr) if (v && typeof v === "string") set.add(v)
  return Array.from(set).sort()
}
