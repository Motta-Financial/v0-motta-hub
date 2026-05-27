import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

// ── Known form types (stored directly in database) ────────────────────
// Real values: "1040", "1065", "1120", "1120S", "990", "1041", "709"
const ALL_FORM_TYPES = ["1040", "1065", "1120", "1120S", "990", "1041", "709"]
const INDIVIDUAL_FORMS = ["1040"]
const BUSINESS_FORMS = ["1065", "1120", "1120S"]
const NONPROFIT_FORMS = ["990"]

const PAGE_SIZE = 50

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const form = url.searchParams.get("form") || "all"
    const taxYear = url.searchParams.get("taxYear")
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1)
    const search = url.searchParams.get("search")?.trim().toLowerCase() || ""

    const supabase = createAdminClient()

    // Determine which form types to filter by
    // When "all", we don't apply any form_type filter (returns all 892 rows)
    let formTypes: string[] | null = null
    if (form === "all") {
      formTypes = null // No filter — return all forms
    } else if (form === "business") {
      formTypes = BUSINESS_FORMS
    } else if (form === "individual") {
      formTypes = INDIVIDUAL_FORMS
    } else if (form === "nonprofit") {
      formTypes = NONPROFIT_FORMS
    } else {
      // Specific form like "1040", "1065", etc.
      formTypes = [form]
    }

    // ══════════════════════════════════════════════════════════════════
    // STAT CARD QUERIES — each uses count: 'exact', head: true
    // ══════════════════════════════════════════════════════════════════

    // Build base filter for stats (applies form and year filters)
    const buildStatsQuery = () => {
      let q = supabase
        .from("proconnect_engagements")
        .select("*", { count: "exact", head: true })

      if (formTypes !== null) {
        q = q.in("form_type", formTypes)
      }
      if (taxYear) {
        q = q.eq("tax_year", Number(taxYear))
      }
      return q
    }

    // Total count
    const totalCountPromise = buildStatsQuery()

    // E-filed count — filter where raw_json->>'customStatus' = 'E-Filed'
    let efiledQuery = supabase
      .from("proconnect_engagements")
      .select("*", { count: "exact", head: true })
      .eq("raw_json->>customStatus", "E-Filed")

    if (formTypes !== null) {
      efiledQuery = efiledQuery.in("form_type", formTypes)
    }
    if (taxYear) {
      efiledQuery = efiledQuery.eq("tax_year", Number(taxYear))
    }

    const efiledCountPromise = efiledQuery

    // Count by form type — run individual counts for display
    const formCountsPromise = Promise.all(
      ALL_FORM_TYPES.map(async (formType) => {
        let q = supabase
          .from("proconnect_engagements")
          .select("*", { count: "exact", head: true })
          .eq("form_type", formType)

        if (taxYear) {
          q = q.eq("tax_year", Number(taxYear))
        }

        const { count } = await q
        return { form: formType, count: count ?? 0 }
      }),
    )

    // Get distinct years for filter chips AND for the byYear card.
    // IMPORTANT: This query must NOT filter by taxYear — it should always
    // return ALL years with returns (optionally filtered by formTypes).
    // We fetch up to 10,000 rows (just the tax_year column) and dedupe
    // client-side. This ensures we capture all distinct years even if
    // most rows are from recent years.
    let yearsQuery = supabase
      .from("proconnect_engagements")
      .select("tax_year")
      .limit(10000)

    if (formTypes !== null) {
      yearsQuery = yearsQuery.in("form_type", formTypes)
    }

    // Fetch tax_year values and dedupe client-side
    const yearsPromise = yearsQuery.order("tax_year", { ascending: false })

    // Status breakdown — fetch distinct status values for the filtered set.
    // We use proconnect_engagements_enriched because user_defined_status_name
    // lives there (joined in from proconnect_profiles). We pull ALL matching
    // rows for the status group-by rather than a paginated slice so the strip
    // counts are always correct regardless of current page.
    const buildStatusQuery = () => {
      let q = supabase
        .from("proconnect_engagements_enriched")
        .select("user_defined_status_name, user_defined_status_color")

      if (formTypes !== null) q = q.in("form_type", formTypes)
      if (taxYear) q = q.eq("tax_year", Number(taxYear))
      return q
    }
    const statusBreakdownPromise = buildStatusQuery()

    // Run all stat queries in parallel
    const [totalRes, efiledRes, formCounts, yearsRes, statusRes] = await Promise.all([
      totalCountPromise,
      efiledCountPromise,
      formCountsPromise,
      yearsPromise,
      statusBreakdownPromise,
    ])

    const totalCount = totalRes.count ?? 0
    const efiledCount = efiledRes.count ?? 0

    // Build byForm map
    const byForm: Record<string, { count: number }> = {}
    for (const fc of formCounts) {
      if (fc.count > 0) {
        byForm[fc.form] = { count: fc.count }
      }
    }

    // Build byStatus map { statusName: { count, color } }
    const byStatus: Record<string, { count: number; color: string | null }> = {}
    for (const row of statusRes.data || []) {
      const key = row.user_defined_status_name || "(no status)"
      if (!byStatus[key]) byStatus[key] = { count: 0, color: row.user_defined_status_color ?? null }
      byStatus[key].count++
    }

    // Get unique years for filter chips
    const uniqueYears = [
      ...new Set((yearsRes.data || []).map((r) => r.tax_year).filter(Boolean)),
    ] as number[]

    // Count by year (for chart)
    const byYear: Record<string, number> = {}
    await Promise.all(
      uniqueYears.slice(0, 10).map(async (year) => {
        let q = supabase
          .from("proconnect_engagements")
          .select("*", { count: "exact", head: true })
          .eq("tax_year", year)

        if (formTypes !== null) {
          q = q.in("form_type", formTypes)
        }

        const { count } = await q
        byYear[String(year)] = count ?? 0
      }),
    )

    // ══════════════════════════════════════════════════════════════════
    // PAGINATED TABLE DATA — uses .range()
    // ══════════════════════════════════════════════════════════════════

    const from = (page - 1) * PAGE_SIZE
    const to = from + PAGE_SIZE - 1

    let dataQuery = supabase
      .from("proconnect_engagements_enriched")
      .select("*")
      .order("proconnect_modified_at", { ascending: false, nullsFirst: false })

    if (formTypes !== null) {
      dataQuery = dataQuery.in("form_type", formTypes)
    }
    if (taxYear) {
      dataQuery = dataQuery.eq("tax_year", Number(taxYear))
    }

    // Apply search filter if provided
    if (search) {
      dataQuery = dataQuery.or(
        `client_display_name.ilike.%${search}%,proconnect_client_id.ilike.%${search}%,preparer_name.ilike.%${search}%`,
      )
    }

    dataQuery = dataQuery.range(from, to)

    const { data: engagements, error: engError } = await dataQuery
    if (engError) throw engError

    // Transform to unified shape
    const returns = (engagements || []).map((eng) => {
      const formType = eng.form_type || eng.return_type || "Unknown"

      return {
        id: eng.engagement_id,
        engagement_id: eng.engagement_id,
        proconnect_client_id: eng.proconnect_client_id,
        client_name: eng.client_display_name || null,
        tax_year: eng.tax_year,
        form: formType,
        return_type: eng.return_type,
        status: eng.status,
        efile_status: eng.efile_status,
        work_status: eng.work_status,
        preparer: eng.preparer_name || null,
        preparer_profile_id: eng.assignee_profile_id,
        user_defined_status_name: eng.user_defined_status_name,
        user_defined_status_color: eng.user_defined_status_color,
        proconnect_modified_at: eng.proconnect_modified_at,
        synced_at: eng.synced_at,
        updated_at: eng.updated_at,
        amended: null,
        revenue: null,
        income: null,
        tax: null,
        refund: null,
        amount_owed: null,
        raw: {},
      }
    })

    const totalPages = Math.ceil(totalCount / PAGE_SIZE)

    const stats = {
      totalReturns: totalCount,
      efiledCount,
      pendingCount: totalCount - efiledCount,
      byForm,
      byYear,
      byStatus,
      byEfileStatus: {
        "(filed)": efiledCount,
        "(not filed)": totalCount - efiledCount,
      },
      // Legacy fields for backward compat
      totalRevenue: 0,
      totalIncome: 0,
      totalTax: 0,
      totalRefunds: 0,
      totalOwed: 0,
      amendedCount: 0,
      byPreparer: {},
    }

    return NextResponse.json({
      returns,
      stats,
      forms: formTypes ?? ALL_FORM_TYPES,
      pagination: {
        page,
        pageSize: PAGE_SIZE,
        totalCount,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
      availableYears: uniqueYears,
    })
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.message
        : e && typeof e === "object" && "message" in e
          ? String((e as { message: unknown }).message)
          : String(e)
    console.error("[v0] Tax returns API error:", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
