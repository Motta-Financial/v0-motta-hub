import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

// ── Tax Department Overview API ──────────────────────────────────────
// Aggregates all the rollups the parent /tax dashboard needs.
// Uses count queries where possible, and a paged loop where we genuinely
// need to scan every row to compute a rollup PostgREST can't express.
// This avoids the silent 1,000-row truncation cap that PostgREST applies
// to bare .select() queries.

const PAGE_SIZE = 1000

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

type ClientRow = {
  proconnect_client_id: string
  client_type: string | null
  synced_at: string | null
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

// Paged fetch — walks the table 1,000 rows at a time so we get every row,
// no PostgREST truncation. Used only for rollups that genuinely require
// every row (e.g. distinct counts, column-level rollups Postgres can't
// express via PostgREST count queries).
async function fetchAllPaged<T>(
  // The query factory must return a "fresh" PostgrestFilterBuilder every
  // time it's invoked, because .range() is destructive on the builder.
  // We type this as `any` because @supabase/supabase-js's filter builder
  // generic chain is too complex to thread cleanly here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queryFactory: () => any,
): Promise<T[]> {
  const out: T[] = []
  let from = 0
  for (;;) {
    const to = from + PAGE_SIZE - 1
    const { data, error } = await queryFactory().range(from, to)
    if (error) throw error
    const batch = (data || []) as T[]
    out.push(...batch)
    if (batch.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return out
}

export async function GET() {
  try {
    const supabase = createAdminClient()

    const [engagements, clients, lastSyncRes] = await Promise.all([
      // Walk the enriched view in 1,000-row pages so we don't silently
      // truncate at the PostgREST cap. The view already joins client
      // display_name + proconnect_profiles + team_members, so preparer_name
      // arrives prejoined.
      fetchAllPaged<EngagementRow>(() =>
        supabase
          .from("proconnect_engagements_enriched")
          .select(
            "engagement_id, proconnect_client_id, tax_year, return_type, form_type, status, efile_status, user_defined_status_id, user_defined_status_name, user_defined_status_color, assignee_profile_id, preparer_name, preparer_email, preparer_team_member_id, proconnect_modified_at",
          ),
      ),
      // Same for clients — paged so we count past 1,000.
      fetchAllPaged<ClientRow>(() =>
        supabase
          .from("proconnect_clients")
          .select("proconnect_client_id, client_type, synced_at"),
      ),
      supabase
        .from("proconnect_sync_logs")
        .select(
          "id, status, started_at, completed_at, clients_synced, engagements_synced, error_message",
        )
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

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
    const yearForm: Record<string, Record<string, number>> = {}
    let unassigned = 0

    const currentTaxYear =
      new Date().getMonth() < 4
        ? new Date().getFullYear() - 1
        : new Date().getFullYear()
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

    const allForms = Array.from(
      new Set(engagements.map((e) => classifyForm(e))),
    ).sort()
    const yearFormSeries = Object.keys(yearForm)
      .filter((y) => y !== "(unknown)")
      .sort()
      .map((y) => {
        const row: Record<string, number | string> = { year: y }
        for (const f of allForms) row[f] = yearForm[y][f] || 0
        return row
      })

    const preparerLeaderboard = Object.entries(byPreparer)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    const distinctAssignees = new Set(
      engagements
        .map((e) => e.assignee_profile_id)
        .filter((x): x is string => Boolean(x)),
    )
    const mappedAssigneeIds = new Set(
      engagements
        .filter((e) => e.assignee_profile_id && e.preparer_name)
        .map((e) => e.assignee_profile_id as string),
    )
    const mappedAssignees = mappedAssigneeIds.size
    const unmappedAssignees = distinctAssignees.size - mappedAssignees

    const customStatusList = Object.entries(byCustomStatus)
      .map(([name, { count, color }]) => ({ name, count, color }))
      .sort((a, b) => b.count - a.count)

    return NextResponse.json({
      totalEngagements: engagements.length,
      totalClients: clients.length,
      personClients: clients.filter((c) => c.client_type === "PERSON").length,
      orgClients: clients.filter((c) => c.client_type === "ORGANIZATION")
        .length,
      currentTaxYear,
      currentYearReturns,
      unassignedReturns: unassigned,

      byForm,
      byYear,
      byCategory,
      byEfileStatus,
      customStatusList,
      preparerLeaderboard,

      yearFormSeries,
      formsTracked: allForms,

      profileMapping: {
        distinct: distinctAssignees.size,
        mapped: mappedAssignees,
        unmapped: unmappedAssignees,
      },

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
