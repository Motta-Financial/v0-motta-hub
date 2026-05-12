import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

// ── Form-type registry ────────────────────────────────────────────────
// Each ProConnect return form lives in its own table with a slightly
// different shape. The shared columns we always project are:
//   id, proconnect_client_id, tax_year, return_type, return_status,
//   efile_status, amended.
// Beyond that, each form has its own "headline" numeric columns that
// matter for the dashboard's KPIs and table — we declare them in this
// registry so the route, the typing, and the UI all stay in sync.
//
// `nameField` is the column we surface as the client display name in
// the unified list (1040 uses export_taxpayer_name, the others use
// export_business_name).
//
// `revenueField` / `incomeField` / `taxField` / `refundField` are the
// canonical money columns each form contributes to the aggregate KPI
// strip on the unified Returns page. They normalize across forms so
// e.g. "Income" means AGI on a 1040 and ordinary_business_income_loss
// on a 1065, but the chart can stack them as one series.
type FormDef = {
  table: string
  nameField: "export_taxpayer_name" | "export_business_name"
  revenueField: string | null // gross receipts / total revenue
  incomeField: string | null // taxable / ordinary biz income
  taxField: string | null // total_tax or total_tax-equivalent
  refundField: string | null // refund / overpayment
  oweField: string | null // amount_owed / balance_due
  // Wide-select column list specific to this form, used for the
  // single-form drill-in queries.
  selectColumns: string
}

const FORM_REGISTRY: Record<string, FormDef> = {
  "1040": {
    table: "proconnect_1040_returns",
    nameField: "export_taxpayer_name",
    revenueField: "wages_salaries_tips",
    incomeField: "adjusted_gross_income",
    taxField: "total_tax",
    refundField: "refund",
    oweField: "amount_owed",
    selectColumns: `id, proconnect_client_id, export_taxpayer_name, tax_year,
      return_type, return_status, efile_status, amended,
      filing_status, taxpayer_occupation,
      adjusted_gross_income, taxable_income, total_tax, refund, amount_owed,
      federal_tax_withheld, wages_salaries_tips, schedule_c_income, schedule_k1_income,
      child_tax_credit, earned_income_credit, qualified_business_income_deduction,
      total_itemized_or_standard_deduction,
      has_schedule_c, has_schedule_e,
      qualifying_children_count, other_dependents_count,
      updated_at`,
  },
  "1065": {
    table: "proconnect_1065_returns",
    nameField: "export_business_name",
    revenueField: "gross_receipts_less_returns",
    incomeField: "ordinary_business_income_loss",
    taxField: null, // partnerships are pass-through — no entity-level tax
    refundField: "overpayment",
    oweField: "total_balance_due",
    selectColumns: `id, proconnect_client_id, export_business_name, tax_year,
      return_type, return_status, efile_status, amended,
      business_activity_code, k1_count, has_8825,
      foreign_partnership, partnership_representative,
      is_domestic_general_partnership, is_domestic_limited_partnership,
      is_domestic_llc, is_domestic_llp,
      gross_receipts_less_returns, cost_of_goods_sold, gross_profit,
      total_income_loss, depreciation, total_deductions,
      ordinary_business_income_loss, net_rental_real_estate_income,
      net_earnings_from_self_employment,
      total_balance_due, overpayment,
      beginning_assets, ending_assets,
      partners_beginning_capital, partners_ending_capital,
      cash_contributions, cash_distributions,
      updated_at`,
  },
  "1120": {
    table: "proconnect_1120_returns",
    nameField: "export_business_name",
    revenueField: "gross_receipts_less_returns",
    incomeField: "taxable_income",
    taxField: "total_tax",
    refundField: null, // 1120 stores net via refund_or_amount_due
    oweField: "tax_due",
    selectColumns: `id, proconnect_client_id, export_business_name, tax_year,
      return_type, return_status, efile_status, amended,
      business_activity_code,
      gross_receipts_less_returns, gross_profit, gross_rent,
      officer_compensation, charitable_contributions, depreciation,
      total_deductions, nol_deduction, taxable_income,
      total_tax, payments_and_credits, refund_or_amount_due, tax_due,
      amount_paid_with_extension,
      beginning_assets, ending_assets,
      beginning_liabilities_and_equity, ending_liabilities_and_equity,
      updated_at`,
  },
  "1120S": {
    table: "proconnect_1120s_returns",
    nameField: "export_business_name",
    revenueField: "gross_receipts_less_returns",
    incomeField: "ordinary_business_income_loss",
    taxField: null, // S-corps are pass-through
    refundField: "refund",
    oweField: "balance_due",
    selectColumns: `id, proconnect_client_id, export_business_name, tax_year,
      return_type, return_status, efile_status, amended,
      business_activity_code, k1_count, has_8825, extension_amount,
      gross_receipts_less_returns, gross_profit, cost_of_goods_sold,
      total_income_loss, compensation_of_officers, depreciation,
      pension_profit_sharing, total_deductions,
      ordinary_business_income_loss, net_rental_real_estate_income,
      charitable_contributions, nondeductible_expenses,
      income_loss_reconciliation,
      overpayment, balance_due, refund,
      beginning_assets, ending_assets,
      beginning_liabilities_and_equity, ending_liabilities_and_equity,
      updated_at`,
  },
  "990": {
    table: "proconnect_990_returns",
    nameField: "export_business_name",
    revenueField: "total_revenue",
    incomeField: "revenue_less_expenses",
    taxField: "pf_tax_due", // only populated for private foundations
    refundField: null,
    oweField: null,
    selectColumns: `id, proconnect_client_id, export_business_name, tax_year,
      return_type, return_subtype, return_status, efile_status, amended,
      ein,
      total_revenue, total_expenses, revenue_less_expenses,
      total_assets_end, total_liabilities_end, net_assets_end,
      ez_contributions, ez_investment_income, ez_total_revenue,
      ez_total_expenses, ez_excess_deficit, ez_net_assets_end,
      pf_tax_due, pf_net_assets_end,
      updated_at`,
  },
}

const FORM_KEYS = Object.keys(FORM_REGISTRY) as Array<keyof typeof FORM_REGISTRY>

// "Unified" row shape used for the cross-form Returns page and for the
// per-form pages alike. Every form normalizes its headline numbers
// into these aliased fields so the table can render a single column
// set regardless of which form a row came from. The form-specific
// numerics also stay on the row (under their native column names) for
// pages that drill in to a single form.
type UnifiedReturn = {
  id: string
  proconnect_client_id: string | null
  client_name: string | null
  tax_year: number | null
  form: string
  return_status: string | null
  efile_status: string | null
  amended: boolean | null
  // Normalized numeric fields. Null when the form doesn't track this
  // concept (e.g. taxField on 1065).
  revenue: number | null
  income: number | null
  tax: number | null
  refund: number | null
  amount_owed: number | null
  updated_at: string | null
  // The raw row data for use by drill-in pages.
  raw: Record<string, any>
}

function num(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const form = url.searchParams.get("form") || "all"
    const taxYear = url.searchParams.get("taxYear")
    const limit = Math.min(Number(url.searchParams.get("limit")) || 500, 2000)

    const supabase = createAdminClient()

    // Decide which form tables to query. "all" hits every table; a
    // specific form hits just that one. We also support the group
    // shortcuts "business" (1065+1120+1120S) and "individual" (1040)
    // so the per-page UI can pass `?form=business` without listing
    // each table.
    let formsToQuery: string[]
    if (form === "all") formsToQuery = FORM_KEYS
    else if (form === "business") formsToQuery = ["1065", "1120", "1120S"]
    else if (form === "individual") formsToQuery = ["1040"]
    else if (form === "nonprofit") formsToQuery = ["990"]
    else if (FORM_KEYS.includes(form as any)) formsToQuery = [form]
    else
      return NextResponse.json(
        { error: `Unknown form '${form}'` },
        { status: 400 },
      )

    // Fetch each form table in parallel. The dataset is small (~hundreds
    // of returns per form max) so we pull the whole filtered set in one
    // round-trip and aggregate in memory.
    const rowsByForm = await Promise.all(
      formsToQuery.map(async (key) => {
        const def = FORM_REGISTRY[key]
        let q = supabase.from(def.table).select(def.selectColumns).limit(limit)
        if (taxYear) q = q.eq("tax_year", Number(taxYear))
        const { data, error } = await q
        if (error) throw error
        return { key, def, data: (data || []) as any[] }
      }),
    )

    // Normalize into the unified row shape, preserving the raw row for
    // drill-in UI consumers.
    const unified: UnifiedReturn[] = []
    for (const { key, def, data } of rowsByForm) {
      for (const r of data) {
        unified.push({
          id: r.id,
          proconnect_client_id: r.proconnect_client_id ?? null,
          client_name: r[def.nameField] ?? null,
          tax_year: r.tax_year ?? null,
          form: key,
          return_status: r.return_status ?? null,
          efile_status: r.efile_status ?? null,
          amended: r.amended ?? null,
          revenue: def.revenueField ? num(r[def.revenueField]) : null,
          income: def.incomeField ? num(r[def.incomeField]) : null,
          tax: def.taxField ? num(r[def.taxField]) : null,
          refund: def.refundField ? num(r[def.refundField]) : null,
          amount_owed: def.oweField ? num(r[def.oweField]) : null,
          updated_at: r.updated_at ?? null,
          raw: r,
        })
      }
    }

    // Newest first feels right for tax review work — partners want to
    // see the most recently touched return when they open the page.
    unified.sort((a, b) => {
      const ta = a.updated_at ? Date.parse(a.updated_at) : 0
      const tb = b.updated_at ? Date.parse(b.updated_at) : 0
      return tb - ta
    })

    // ── Aggregate stats over the *returned* set ──────────────────────
    // We surface the same six headline KPIs on every tax page; the
    // pages decide which ones to display based on what's meaningful
    // for their form. Pass-through forms (1065/1120S) contribute
    // null tax — those nulls are skipped in the sum so we don't mix
    // partnership distributions into "total tax collected".
    const stats = {
      totalReturns: unified.length,
      totalRevenue: 0,
      totalIncome: 0,
      totalTax: 0,
      totalRefunds: 0,
      totalOwed: 0,
      // Distribution by form makes the unified Returns page a useful
      // "what's our book look like" reading at a glance.
      byForm: {} as Record<string, { count: number; revenue: number; income: number }>,
      // Distribution by tax year (single year today, but the schema
      // supports historical years so we plan for them).
      byYear: {} as Record<string, number>,
      // efile status pie — null counts as "not filed yet".
      byEfileStatus: {} as Record<string, number>,
    }
    for (const r of unified) {
      stats.totalRevenue += r.revenue ?? 0
      stats.totalIncome += r.income ?? 0
      stats.totalTax += r.tax ?? 0
      stats.totalRefunds += r.refund ?? 0
      stats.totalOwed += r.amount_owed ?? 0
      const fb =
        stats.byForm[r.form] ??
        (stats.byForm[r.form] = { count: 0, revenue: 0, income: 0 })
      fb.count += 1
      fb.revenue += r.revenue ?? 0
      fb.income += r.income ?? 0
      const yKey = r.tax_year ? String(r.tax_year) : "(unknown)"
      stats.byYear[yKey] = (stats.byYear[yKey] || 0) + 1
      const eKey = r.efile_status ?? "(not filed)"
      stats.byEfileStatus[eKey] = (stats.byEfileStatus[eKey] || 0) + 1
    }

    return NextResponse.json({
      returns: unified,
      stats,
      forms: formsToQuery,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
