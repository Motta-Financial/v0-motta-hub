import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import {
  CANONICAL_SERVICES,
  resolveService,
  type CanonicalService,
} from "@/lib/sales/service-catalog"
import { classifyService, type ServiceLine } from "@/lib/sales/service-line-classifier"

/**
 * Sales > Services catalog endpoint.
 *
 * Two view modes, selected by `?groupBy=`:
 *
 *   • `catalog` (legacy default) — one row per `ignition_services` row,
 *     joined with usage counts from `ignition_proposal_services`. Useful
 *     when you need to manage the catalog itself.
 *
 *   • `canonical` (new default) — rows are *canonical* services from
 *     `lib/sales/service-catalog.ts`, with usage stats rolled up across
 *     every alias / pattern match. This collapses obvious duplicates
 *     (e.g. "Individual Tax Return (1040)" + "Tax | Prep (1040)…" +
 *     "Tax Preparation: Individual Income Tax Return (1040)" → one row
 *     for "Tax Prep — Individual Federal (1040)") so dashboards
 *     accurately reflect how many of each service we sold, not how many
 *     ways someone named it.
 *
 * Volumes are tiny (~170 catalog rows, ~440 line items) so we aggregate
 * client-side after a single round-trip per table.
 */

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const sp = url.searchParams

  const groupBy = (sp.get("groupBy") || "canonical") as "canonical" | "catalog"
  const search = (sp.get("search") || "").trim().toLowerCase()
  const category = sp.get("category") || ""
  const billingType = sp.get("billingType") || ""
  const serviceLineParam = sp.get("serviceLine") || ""
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

  // ── Per-line-item aggregation, double-keyed: by service id (for the
  //    catalog view) and by canonical id (for the canonical view).
  //    Walking the line items once and emitting two aggregate maps is
  //    cheaper than hashing twice.
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
    /** Distinct line-item names seen under this aggregate key. */
    nameVariants: Map<string, number>
  }
  const newAgg = (): Agg => ({
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
    nameVariants: new Map(),
  })
  const aggByCatalogKey = new Map<string, Agg>()
  const seenProposalsByCatalogKey = new Map<string, Set<string>>()
  const aggByCanonicalId = new Map<string, Agg>()
  const seenProposalsByCanonicalId = new Map<string, Set<string>>()

  // We resolve every line item's canonical id once and remember it so
  // the catalog view (which surfaces the canonical link per row) can
  // reuse the result without re-resolving.
  const canonicalForLineItem: Array<string | null> = []

  for (const li of lineItemsRes.data || []) {
    // ── Catalog-keyed aggregation ─────────────────────────────────────
    const catalogKey =
      li.ignition_service_id || `name:${(li.service_name || "").toLowerCase()}`
    if (!aggByCatalogKey.has(catalogKey)) {
      aggByCatalogKey.set(catalogKey, newAgg())
      seenProposalsByCatalogKey.set(catalogKey, new Set())
    }
    const catAgg = aggByCatalogKey.get(catalogKey)!
    const catSeen = seenProposalsByCatalogKey.get(catalogKey)!

    // ── Canonical-keyed aggregation ───────────────────────────────────
    const resolved = resolveService(li.service_name, classifyService)
    canonicalForLineItem.push(resolved.id)
    if (!aggByCanonicalId.has(resolved.id)) {
      aggByCanonicalId.set(resolved.id, newAgg())
      seenProposalsByCanonicalId.set(resolved.id, new Set())
    }
    const canAgg = aggByCanonicalId.get(resolved.id)!
    const canSeen = seenProposalsByCanonicalId.get(resolved.id)!

    const proposalStatus = li.proposal_id
      ? proposalStatusById.get(li.proposal_id)
      : null
    const total = Number(li.total_amount) || 0
    const unitPrice = Number(li.unit_price) || 0

    // Proposal-distinct counters (each proposal counted once per group).
    if (li.proposal_id) {
      if (!catSeen.has(li.proposal_id)) {
        catSeen.add(li.proposal_id)
        catAgg.proposalCount += 1
        if (isAccepted(proposalStatus)) catAgg.acceptedCount += 1
        if (proposalStatus === "lost") catAgg.lostCount += 1
      }
      if (!canSeen.has(li.proposal_id)) {
        canSeen.add(li.proposal_id)
        canAgg.proposalCount += 1
        if (isAccepted(proposalStatus)) canAgg.acceptedCount += 1
        if (proposalStatus === "lost") canAgg.lostCount += 1
      }
    }

    // Line-level counters (revenue, units, billing-freq, name variants).
    for (const a of [catAgg, canAgg]) {
      a.totalRevenue += total
      if (isAccepted(proposalStatus)) a.acceptedRevenue += total
      a.units += Number(li.quantity) || 0
      if (unitPrice > 0) {
        a.sumPrice += unitPrice
        a.pricePoints += 1
      }
      if (li.currency) a.currency = li.currency
      if (li.billing_frequency) a.billingFrequencies.add(li.billing_frequency)
      if (li.service_name) {
        a.nameVariants.set(
          li.service_name,
          (a.nameVariants.get(li.service_name) ?? 0) + 1,
        )
      }
    }
  }

  // ── Catalog-view rows ────────────────────────────────────────────────
  // One row per `ignition_services` entry, plus the canonical id it
  // collapses into so the UI can render a "Also called:" hint.
  const catalogRows = (servicesRes.data || []).map((s) => {
    const catalogKey = s.ignition_service_id
    const fallbackKey = `name:${(s.name || "").toLowerCase()}`
    const agg =
      aggByCatalogKey.get(catalogKey) || aggByCatalogKey.get(fallbackKey)
    const avgPrice =
      agg && agg.pricePoints > 0 ? agg.sumPrice / agg.pricePoints : null
    const resolved = resolveService(s.name, classifyService)
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
      serviceLine: resolved.serviceLine as ServiceLine,
      canonicalId: resolved.isCanonical ? resolved.id : null,
      canonicalLabel: resolved.isCanonical ? resolved.label : null,
    }
  })

  // ── Canonical-view rows ──────────────────────────────────────────────
  // One row per *canonical* service, with stats rolled up across every
  // alias. We seed the result with every catalog entry in the canonical
  // dictionary (so empty canonicals show up as "0 sold" rather than
  // disappearing) and then layer in the synthetic `raw:…` rows for any
  // line-item names we haven't classified yet.
  type CanonicalRow = {
    id: string
    label: string
    serviceLine: ServiceLine
    isCanonical: boolean
    description: string | null
    /** All `ignition_services` rows whose name maps to this canonical. */
    catalogVariants: Array<{
      ignition_service_id: string
      name: string
      default_price: number | null
      currency: string
      is_active: boolean
      category: string | null
      billing_type: string | null
    }>
    /**
     * Proposal-line names seen under this canonical id, with the count
     * of line items each name appears on. Helpful for explaining "why
     * are these grouped together?" in the UI.
     */
    proposalNameVariants: Array<{ name: string; count: number }>
    /** Catalog count (catalog rows mapped here). */
    catalogCount: number
    /** Total distinct names this canonical has been seen as. */
    variantCount: number
    proposalCount: number
    acceptedCount: number
    lostCount: number
    totalRevenue: number
    acceptedRevenue: number
    units: number
    avgPrice: number | null
    currency: string
    billingFrequencies: string[]
    /** Are *any* of the catalog variants currently active? */
    isActive: boolean
    /** Categories spanned across catalog variants. */
    categories: string[]
    billingTypes: string[]
  }

  const canonicalRowsById = new Map<string, CanonicalRow>()

  // Seed from the canonical catalog so unsold services still appear.
  for (const svc of CANONICAL_SERVICES) {
    canonicalRowsById.set(svc.id, {
      id: svc.id,
      label: svc.label,
      serviceLine: svc.serviceLine,
      isCanonical: true,
      description: svc.description ?? null,
      catalogVariants: [],
      proposalNameVariants: [],
      catalogCount: 0,
      variantCount: 0,
      proposalCount: 0,
      acceptedCount: 0,
      lostCount: 0,
      totalRevenue: 0,
      acceptedRevenue: 0,
      units: 0,
      avgPrice: null,
      currency: "USD",
      billingFrequencies: [],
      isActive: false,
      categories: [],
      billingTypes: [],
    })
  }

  // Merge in catalog rows.
  for (const row of catalogRows) {
    const resolved = resolveService(row.name, classifyService)
    const id = resolved.id
    if (!canonicalRowsById.has(id)) {
      canonicalRowsById.set(id, {
        id,
        label: resolved.label,
        serviceLine: resolved.serviceLine,
        isCanonical: resolved.isCanonical,
        description: null,
        catalogVariants: [],
        proposalNameVariants: [],
        catalogCount: 0,
        variantCount: 0,
        proposalCount: 0,
        acceptedCount: 0,
        lostCount: 0,
        totalRevenue: 0,
        acceptedRevenue: 0,
        units: 0,
        avgPrice: null,
        currency: row.currency,
        billingFrequencies: [],
        isActive: false,
        categories: [],
        billingTypes: [],
      })
    }
    const target = canonicalRowsById.get(id)!
    target.catalogVariants.push({
      ignition_service_id: row.ignition_service_id,
      name: row.name,
      default_price: row.default_price,
      currency: row.currency,
      is_active: row.is_active,
      category: row.category,
      billing_type: row.billing_type,
    })
    target.catalogCount += 1
    if (row.is_active) target.isActive = true
    if (row.category && !target.categories.includes(row.category)) {
      target.categories.push(row.category)
    }
    if (row.billing_type && !target.billingTypes.includes(row.billing_type)) {
      target.billingTypes.push(row.billing_type)
    }
  }

  // Layer in proposal-line-item aggregations.
  for (const [canonicalId, agg] of aggByCanonicalId.entries()) {
    if (!canonicalRowsById.has(canonicalId)) {
      // Synthetic `raw:…` row — name not yet in the canonical catalog.
      // We label with the most common variant name for friendliness.
      const variants = Array.from(agg.nameVariants.entries()).sort(
        (a, b) => b[1] - a[1],
      )
      const topName = variants[0]?.[0] ?? canonicalId
      canonicalRowsById.set(canonicalId, {
        id: canonicalId,
        label: topName,
        serviceLine: classifyService(topName),
        isCanonical: false,
        description: null,
        catalogVariants: [],
        proposalNameVariants: [],
        catalogCount: 0,
        variantCount: 0,
        proposalCount: 0,
        acceptedCount: 0,
        lostCount: 0,
        totalRevenue: 0,
        acceptedRevenue: 0,
        units: 0,
        avgPrice: null,
        currency: agg.currency || "USD",
        billingFrequencies: [],
        isActive: false,
        categories: [],
        billingTypes: [],
      })
    }
    const target = canonicalRowsById.get(canonicalId)!
    target.proposalCount += agg.proposalCount
    target.acceptedCount += agg.acceptedCount
    target.lostCount += agg.lostCount
    target.totalRevenue += agg.totalRevenue
    target.acceptedRevenue += agg.acceptedRevenue
    target.units += agg.units
    if (agg.pricePoints > 0) {
      // Weighted average across every alias's per-line price points.
      const prevPoints = target.avgPrice !== null && target.units > 0 ? 1 : 0
      const prevSum = target.avgPrice ? target.avgPrice * prevPoints : 0
      target.avgPrice =
        (prevSum + agg.sumPrice) / (prevPoints + agg.pricePoints)
    }
    if (agg.currency && target.currency === "USD") target.currency = agg.currency
    for (const f of agg.billingFrequencies) {
      if (!target.billingFrequencies.includes(f))
        target.billingFrequencies.push(f)
    }
    for (const [name, count] of agg.nameVariants.entries()) {
      target.proposalNameVariants.push({ name, count })
    }
  }

  // Tidy: sort variants and compute variantCount.
  const canonicalRows: CanonicalRow[] = Array.from(canonicalRowsById.values())
  for (const row of canonicalRows) {
    row.proposalNameVariants.sort((a, b) => b.count - a.count)
    row.billingFrequencies.sort()
    row.categories.sort()
    row.billingTypes.sort()
    const namesSet = new Set<string>()
    for (const v of row.catalogVariants) namesSet.add(v.name.toLowerCase())
    for (const v of row.proposalNameVariants) namesSet.add(v.name.toLowerCase())
    row.variantCount = namesSet.size
  }

  // ── Filter ──────────────────────────────────────────────────────────
  const serviceLineList = serviceLineParam.split(",").filter(Boolean) as ServiceLine[]
  const categoryList = category.split(",").filter(Boolean)
  const billingTypeList = billingType.split(",").filter(Boolean)

  function applyCommonFilters<T extends {
    serviceLine: ServiceLine
    isActive?: boolean
    is_active?: boolean
  }>(rows: T[]): T[] {
    return rows.filter((row) => {
      if (serviceLineList.length && !serviceLineList.includes(row.serviceLine))
        return false
      if (activeOnly && !(row.isActive ?? row.is_active)) return false
      return true
    })
  }

  let filteredCatalog = catalogRows.map((r) => ({
    ...r,
    isActive: r.is_active,
  }))
  let filteredCanonical = canonicalRows.slice()

  if (search) {
    filteredCatalog = filteredCatalog.filter(
      (s) =>
        (s.name || "").toLowerCase().includes(search) ||
        (s.description || "").toLowerCase().includes(search) ||
        (s.category || "").toLowerCase().includes(search) ||
        (s.canonicalLabel || "").toLowerCase().includes(search),
    )
    filteredCanonical = filteredCanonical.filter((s) => {
      if (s.label.toLowerCase().includes(search)) return true
      if (s.id.toLowerCase().includes(search)) return true
      if ((s.description || "").toLowerCase().includes(search)) return true
      for (const v of s.catalogVariants) {
        if (v.name.toLowerCase().includes(search)) return true
      }
      for (const v of s.proposalNameVariants) {
        if (v.name.toLowerCase().includes(search)) return true
      }
      return false
    })
  }
  if (categoryList.length) {
    filteredCatalog = filteredCatalog.filter(
      (s) => s.category && categoryList.includes(s.category),
    )
    filteredCanonical = filteredCanonical.filter((s) =>
      s.categories.some((c) => categoryList.includes(c)),
    )
  }
  if (billingTypeList.length) {
    filteredCatalog = filteredCatalog.filter(
      (s) => s.billing_type && billingTypeList.includes(s.billing_type),
    )
    filteredCanonical = filteredCanonical.filter((s) =>
      s.billingTypes.some((b) => billingTypeList.includes(b)),
    )
  }
  filteredCatalog = applyCommonFilters(filteredCatalog)
  filteredCanonical = applyCommonFilters(filteredCanonical)

  // ── Sort ────────────────────────────────────────────────────────────
  const validSorts = new Set([
    "name",
    "label",
    "category",
    "totalRevenue",
    "acceptedRevenue",
    "proposalCount",
    "acceptedCount",
    "default_price",
    "avgPrice",
    "variantCount",
    "catalogCount",
  ])
  const finalSort = validSorts.has(sortBy) ? sortBy : "totalRevenue"
  const cmp = (a: any, b: any, key: string) => {
    // For canonical rows, "name" sorts on `label`; for catalog, on `name`.
    const av = a[key] ?? a[key === "name" ? "label" : "name"]
    const bv = b[key] ?? b[key === "name" ? "label" : "name"]
    if (av === bv) return 0
    if (av === null || av === undefined) return 1
    if (bv === null || bv === undefined) return -1
    if (typeof av === "string") {
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av)
    }
    return sortDir === "asc" ? av - bv : bv - av
  }
  filteredCatalog.sort((a, b) => cmp(a, b, finalSort))
  filteredCanonical.sort((a, b) => cmp(a, b, finalSort))

  // ── Dimensions for filter chips ──────────────────────────────────────
  const dimensions = {
    categories: uniqueSorted(catalogRows.map((s) => s.category)),
    billingTypes: uniqueSorted(catalogRows.map((s) => s.billing_type)),
    serviceLines: ["Tax", "Accounting", "Advisory", "Other"] as ServiceLine[],
  }

  // ── Aggregate KPIs (across the *unfiltered* set so users see totals
  //    that don't shift based on what's filtered).
  const stats = {
    totalServices: catalogRows.length,
    activeServices: catalogRows.filter((s) => s.is_active).length,
    canonicalServices: canonicalRows.length,
    canonicalCovered: canonicalRows.filter((r) => r.isCanonical).length,
    totalRevenue: catalogRows.reduce((sum, s) => sum + s.totalRevenue, 0),
    acceptedRevenue: catalogRows.reduce((sum, s) => sum + s.acceptedRevenue, 0),
    totalProposalLines: lineItemsRes.data?.length || 0,
    duplicateGroups: countDuplicateGroups(canonicalRows),
  }

  return NextResponse.json({
    groupBy,
    services: groupBy === "canonical" ? filteredCanonical : filteredCatalog,
    catalogServices: filteredCatalog,
    canonicalServices: filteredCanonical,
    dimensions,
    stats,
  })
}

function uniqueSorted(arr: (string | null | undefined)[]): string[] {
  const set = new Set<string>()
  for (const v of arr) if (v && typeof v === "string") set.add(v)
  return Array.from(set).sort()
}

/**
 * Counts canonical rows that fold *more than one* distinct catalog or
 * proposal-line name into themselves. This is the "consolidation
 * impact" KPI shown on the Services page header.
 */
function countDuplicateGroups(
  rows: Array<{ variantCount: number; isCanonical: boolean }>,
): number {
  return rows.filter((r) => r.isCanonical && r.variantCount > 1).length
}
