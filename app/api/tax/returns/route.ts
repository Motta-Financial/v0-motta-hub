import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

// ── Return type mapping ───────────────────────────────────────────────
const RETURN_TYPE_TO_FORM: Record<string, string> = {
  IND: "1040",
  COR: "1120",
  PAR: "1065",
  SCO: "1120S",
  FID: "1041",
  EXM: "990",
}

const FORM_TO_RETURN_TYPES: Record<string, string[]> = {
  "1040": ["IND"],
  "1120": ["COR"],
  "1065": ["PAR"],
  "1120S": ["SCO"],
  "1041": ["FID"],
  "990": ["EXM"],
}

const PAGE_SIZE = 50

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const form = url.searchParams.get("form") || "all"
    const taxYear = url.searchParams.get("taxYear")
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1)
    const search = url.searchParams.get("search")?.trim().toLowerCase() || ""

    const supabase = createAdminClient()

    // Determine which form types to query
    let formTypes: string[] = []
    if (form === "all") {
      formTypes = ["1040", "1065", "1120", "1120S", "990", "1041"]
    } else if (form === "business") {
      formTypes = ["1065", "1120", "1120S"]
    } else if (form === "individual") {
      formTypes = ["1040"]
    } else if (form === "nonprofit") {
      formTypes = ["990"]
    } else {
      formTypes = [form]
    }

    // Get corresponding return_type codes for Supabase filter
    const returnTypeCodes = formTypes.flatMap(
      (f) => FORM_TO_RETURN_TYPES[f] || [],
    )

    // ══════════════════════════════════════════════════════════════════
    // STAT CARD QUERIES — each uses count: 'exact', head: true
    // ══════════════════════════════════════════════════════════════════

    // Build base filter for stats (applies form and year filters)
    const buildStatsQuery = () => {
      let q = supabase
        .from("proconnect_engagements")
        .select("*", { count: "exact", head: true })

      if (returnTypeCodes.length > 0) {
        q = q.in("return_type", returnTypeCodes)
      }
      if (taxYear) {
        q = q.eq("tax_year", Number(taxYear))
      }
      return q
    }

    // Total count
    const totalCountPromise = buildStatsQuery()

    // E-filed (accepted) — check user_defined_status_id or raw_json customStatus
    // We use a text search on raw_json for filed/accepted patterns
    const efiledCountPromise = supabase
      .from("proconnect_engagements")
      .select("*", { count: "exact", head: true })
      .in("return_type", returnTypeCodes.length > 0 ? returnTypeCodes : ["IND", "COR", "PAR", "SCO", "EXM", "FID"])
      .or("efile_status.ilike.%accept%,efile_status.ilike.%filed%,efile_status.ilike.%complete%")
      .then((res) => res)

    // Count by form type — run individual counts
    const formCountsPromise = Promise.all(
      formTypes.map(async (formType) => {
        const codes = FORM_TO_RETURN_TYPES[formType] || []
        if (codes.length === 0) return { form: formType, count: 0 }

        let q = supabase
          .from("proconnect_engagements")
          .select("*", { count: "exact", head: true })
          .in("return_type", codes)

        if (taxYear) {
          q = q.eq("tax_year", Number(taxYear))
        }

        const { count } = await q
        return { form: formType, count: count ?? 0 }
      }),
    )

    // Count by year — get distinct years first, then count each
    const yearsPromise = supabase
      .from("proconnect_engagements")
      .select("tax_year")
      .in("return_type", returnTypeCodes.length > 0 ? returnTypeCodes : ["IND", "COR", "PAR", "SCO", "EXM", "FID"])
      .order("tax_year", { ascending: false })
      .limit(20)

    // Run all stat queries in parallel
    const [totalRes, efiledRes, formCounts, yearsRes] = await Promise.all([
      totalCountPromise,
      efiledCountPromise,
      formCountsPromise,
      yearsPromise,
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

    // Get unique years for filter chips
    const uniqueYears = [
      ...new Set((yearsRes.data || []).map((r) => r.tax_year).filter(Boolean)),
    ] as number[]

    // Count by year
    const byYear: Record<string, number> = {}
    await Promise.all(
      uniqueYears.slice(0, 10).map(async (year) => {
        let q = supabase
          .from("proconnect_engagements")
          .select("*", { count: "exact", head: true })
          .eq("tax_year", year)

        if (returnTypeCodes.length > 0) {
          q = q.in("return_type", returnTypeCodes)
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

    if (returnTypeCodes.length > 0) {
      dataQuery = dataQuery.in("return_type", returnTypeCodes)
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
      const formType =
        eng.form_type ||
        RETURN_TYPE_TO_FORM[eng.return_type || ""] ||
        eng.return_type ||
        "Unknown"

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
        // These fields may not exist in enriched view but keep for compat
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
      forms: formTypes,
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
