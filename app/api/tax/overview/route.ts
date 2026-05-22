import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

// ── Tax Department Overview API ──────────────────────────────────────
// One call → everything the parent /tax dashboard needs to render. We
// roll up directly off the live ProConnect tables (proconnect_engagements
// + proconnect_clients + proconnect_sync_logs + proconnect_profiles) so
// this view is a strict mirror of the firm's actual ProConnect ledger,
// not a Karbon-task approximation.
//
// Why one route instead of reusing /api/tax/returns + /api/tax/clients:
//   - The overview only needs *aggregates*, never the row-level list, so
//     we can answer in a single query roundtrip + a tiny rollup loop.
//   - Surfacing freshness (last sync, last error) here lets the page
//     show a "live data, X minutes ago" pill, which the row-level
//     endpoints don't carry.

type EngagementRow = {
  engagement_id: string
  proconnect_client_id: string | null
  tax_year: number | null
  return_type: string | null
  form_type: string | null
  status: string | null
  efile_status: string | null
  user_defined_status_id: string | null
  user_defined_status_name: string | null
  user_defined_status_color: string | null
  assignee_profile_id: string | null
  preparer_name: string | null
  preparer_email: string | null
  preparer_team_member_id: string | null
  proconnect_modified_at: string | null
}

const RETURN_TYPE_TO_FORM: Record<string, string> = {
  IND: "1040",
  COR: "1120",
  PAR: "1065",
  SCO: "1120S",
  FID: "1041",
  EXM: "990",
}

function classifyForm(eng: EngagementRow): string {
  return (
    eng.form_type ||
    RETURN_TYPE_TO_FORM[eng.return_type || ""] ||
    eng.return_type ||
    "Unknown"
  )
}

function bucketCategory(form: string): "individual" | "business" | "nonprofit" | "other" {
  if (form === "1040") return "individual"
  if (form === "1065" || form === "1120" || form === "1120S") return "business"
  if (form === "990") return "nonprofit"
  return "other"
}

export async function GET() {
  try {
    const supabase = createAdminClient()

    const [engagementsRes, clientsRes, lastSyncRes] = await Promise.all([
      // The enriched view already joins client display_name +
      // proconnect_profiles + team_members, so we get preparer_name
      // for free. No secondary lookup needed.
      supabase
        .from("proconnect_engagements_enriched")
        .select(
          "engagement_id, proconnect_client_id, tax_year, return_type, form_type, status, efile_status, user_defined_status_id, user_defined_status_name, user_defined_status_color, assignee_profile_id, preparer_name, preparer_email, preparer_team_member_id, proconnect_modified_at",
        ),
      supabase
        .from("proconnect_clients")
        .select("proconnect_client_id, client_type, synced_at"),
      supabase
        .from("proconnect_sync_logs")
        .select("id, status, started_at, completed_at, clients_synced, engagements_synced, error_message")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    if (engagementsRes.error) throw engagementsRes.error
    if (clientsRes.error) throw clientsRes.error

    const engagements = (engagementsRes.data || []) as EngagementRow[]
    const clients = clientsRes.data || []

    // ── Single rollup pass ──────────────────────────────────────────
    // Avoid N table walks by computing every metric the page needs in
    // one for-loop. Order is: form, year, e-file status, custom status,
    // preparer, category bucket.
    const byForm: Record<string, number> = {}
    const byYear: Record<string, number> = {}
    const byEfileStatus: Record<string, number> = {}
    const byCustomStatus: Record<
      string,
      { count: number; color: string | null }
    > = {}
    const byPreparer: Record<string, number> = {}
    const byCategory = { individual: 0, business: 0, nonprofit: 0, other: 0 }
    const yearForm: Record<string, Record<string, number>> = {} // year -> form -> count
    let unassigned = 0

    const currentTaxYear = new Date().getMonth() < 4 ? new Date().getFullYear() - 1 : new Date().getFullYear()
    let currentYearReturns = 0

    for (const eng of engagements) {
      const form = classifyForm(eng)
      byForm[form] = (byForm[form] || 0) + 1

      const yearKey = eng.tax_year ? String(eng.tax_year) : "(unknown)"
      byYear[yearKey] = (byYear[yearKey] || 0) + 1

      if (eng.tax_year === currentTaxYear) currentYearReturns++

      const eKey = eng.efile_status || "(not filed)"
      byEfileStatus[eKey] = (byEfileStatus[eKey] || 0) + 1

      if (eng.user_defined_status_name) {
        const slot =
          byCustomStatus[eng.user_defined_status_name] ??
          (byCustomStatus[eng.user_defined_status_name] = {
            count: 0,
            color: eng.user_defined_status_color,
          })
        slot.count += 1
      }

      const preparerName = eng.preparer_name
      if (preparerName) {
        byPreparer[preparerName] = (byPreparer[preparerName] || 0) + 1
      } else {
        unassigned += 1
      }

      byCategory[bucketCategory(form)] += 1

      if (eng.tax_year) {
        const yk = String(eng.tax_year)
        const slot = yearForm[yk] ?? (yearForm[yk] = {})
        slot[form] = (slot[form] || 0) + 1
      }
    }

    // Sort year-form rows ascending by year, all forms aligned for chart consumption.
    const allForms = Array.from(new Set(engagements.map((e) => classifyForm(e)))).sort()
    const yearFormSeries = Object.keys(yearForm)
      .filter((y) => y !== "(unknown)")
      .sort()
      .map((y) => {
        const row: Record<string, number | string> = { year: y }
        for (const f of allForms) row[f] = yearForm[y][f] || 0
        return row
      })

    // Top 10 preparers, descending. "(unassigned)" is reported separately.
    const preparerLeaderboard = Object.entries(byPreparer)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    // Coverage of the profile mapping table — surfaces the "needs attention"
    // banner on the dashboard so admins know they have unmapped IDs.
    const distinctAssignees = new Set(
      engagements
        .map((e) => e.assignee_profile_id)
        .filter((x): x is string => Boolean(x)),
    )
    // An assignee is "mapped" if any row with that profile_id resolved
    // a non-null preparer_name (which the view computed by joining
    // proconnect_profiles + team_members).
    const mappedAssigneeIds = new Set(
      engagements
        .filter((e) => e.assignee_profile_id && e.preparer_name)
        .map((e) => e.assignee_profile_id as string),
    )
    const mappedAssignees = mappedAssigneeIds.size
    const unmappedAssignees = distinctAssignees.size - mappedAssignees

    // Sort custom-status array for the page chart.
    const customStatusList = Object.entries(byCustomStatus)
      .map(([name, { count, color }]) => ({ name, count, color }))
      .sort((a, b) => b.count - a.count)

    return NextResponse.json({
      // Headline KPIs
      totalEngagements: engagements.length,
      totalClients: clients.length,
      personClients: clients.filter((c) => c.client_type === "PERSON").length,
      orgClients: clients.filter((c) => c.client_type === "ORGANIZATION").length,
      currentTaxYear,
      currentYearReturns,
      unassignedReturns: unassigned,

      // Distributions
      byForm,
      byYear,
      byCategory,
      byEfileStatus,
      customStatusList,
      preparerLeaderboard,

      // Time-series for charts
      yearFormSeries,
      formsTracked: allForms,

      // Profile mapping coverage
      profileMapping: {
        distinct: distinctAssignees.size,
        mapped: mappedAssignees,
        unmapped: unmappedAssignees,
      },

      // Sync freshness
      lastSync: lastSyncRes.data
        ? {
            id: lastSyncRes.data.id,
            status: lastSyncRes.data.status,
            startedAt: lastSyncRes.data.started_at,
            completedAt: lastSyncRes.data.completed_at,
            clientsSynced: lastSyncRes.data.clients_synced,
            engagementsSynced: lastSyncRes.data.engagements_synced,
            errorMessage: lastSyncRes.data.error_message,
          }
        : null,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[v0] Tax overview API error:", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
