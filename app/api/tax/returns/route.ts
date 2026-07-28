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
    // STAT CARD QUERIES — one round trip via the tax_return_facets RPC
    // (scripts/351). Previously ~19 separate count queries per request,
    // and the status strip fetched every matching row to tally in JS —
    // silently under-counting past PostgREST's 1,000-row cap.
    // ══════════════════════════════════════════════════════════════════

    type Facets = {
      total: number
      efiled: number
      by_form: Record<string, number>
      by_year: Record<string, number>
      by_status: Array<{ name: string | null; color: string | null; count: number }>
      years: number[]
    }
    const { data: facetsData, error: facetsErr } = await supabase.rpc("tax_return_facets", {
      p_form_types: formTypes,
      p_tax_year: taxYear ? Number(taxYear) : null,
    })
    if (facetsErr) {
      return NextResponse.json({ error: facetsErr.message }, { status: 500 })
    }
    const facets = facetsData as Facets

    const totalCount = facets.total ?? 0
    const efiledCount = facets.efiled ?? 0

    // byForm map — only forms in our known list, only non-zero (matches
    // the previous per-form count behavior)
    const byForm: Record<string, { count: number }> = {}
    for (const formType of ALL_FORM_TYPES) {
      const count = facets.by_form?.[formType] ?? 0
      if (count > 0) byForm[formType] = { count }
    }

    // byStatus map { statusName: { count, color } }
    const byStatus: Record<string, { count: number; color: string | null }> = {}
    for (const row of facets.by_status ?? []) {
      const key = row.name || "(no status)"
      byStatus[key] = {
        count: (byStatus[key]?.count ?? 0) + row.count,
        color: byStatus[key]?.color ?? row.color ?? null,
      }
    }

    const uniqueYears = facets.years ?? []
    const byYear: Record<string, number> = facets.by_year ?? {}

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
        // The scalar alone can't say WHICH filing was rejected — see
        // EfileBadge in components/tax/tax-shared.tsx.
        efile_latest: eng.efile_latest ?? null,
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
