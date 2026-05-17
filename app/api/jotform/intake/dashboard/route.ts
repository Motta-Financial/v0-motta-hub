import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * GET /api/jotform/intake/dashboard — server-computed aggregates for
 * the Intake Dashboard view at /sales/intake/dashboard.
 *
 * We deliberately keep this endpoint dedicated rather than reusing
 * `/api/jotform/intake` because the dashboard needs many more rows
 * (we pull up to 5 000 to compute true monthly inflow), but only a
 * handful of columns. Returning the raw rows would balloon the
 * response into 5–20 MB of `raw_answers` blobs; the aggregator
 * returns ~3 KB of JSON regardless of inbox size.
 *
 * Aggregates:
 *   • totals          — total / new / converted / declined / linked / with-karbon
 *   • byStatus        — count per `lead_status` (drives funnel chart)
 *   • byFocus         — count per `service_focus`
 *   • byState         — top-10 states (submitter_state || business_state)
 *   • byService       — top-10 requested services across both
 *                       single-string and array variants of the column
 *   • byReferral      — top-10 referral_source values (free text)
 *   • byMonth         — last 12 calendar months of submission counts
 *   • byProfessional  — count per resolved `preferred_team_member_id`
 *
 * Auth: signed-in staff only — same posture as `/api/jotform/intake`.
 * We rely on the admin client + the page's auth guard.
 */
export async function GET() {
  try {
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from("jotform_intake_submissions")
      .select(
        `
        jotform_created_at,
        lead_status,
        service_focus,
        submitter_state,
        business_state,
        services_requested,
        referral_source,
        preferred_team_member_id,
        contact_id,
        organization_id,
        karbon_work_item_key
        `,
      )
      .order("jotform_created_at", { ascending: false, nullsFirst: false })
      .limit(5000)

    if (error) throw error
    const rows = data ?? []

    // ─── totals ─────────────────────────────────────────────────
    const totals = {
      total: rows.length,
      new: 0,
      contacted: 0,
      qualified: 0,
      converted: 0,
      declined: 0,
      linkedToClient: 0,
      withKarbonWorkItem: 0,
      thisMonth: 0,
      last30: 0,
    }
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const last30Cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    const byStatus: Record<string, number> = {}
    const byFocus: Record<string, number> = {}
    const byState: Record<string, number> = {}
    const byService: Record<string, number> = {}
    const byReferral: Record<string, number> = {}
    const byMonth: Record<string, number> = {} // YYYY-MM → count
    const byProfessional: Record<string, number> = {} // preferred_team_member_id → count

    // Pre-seed last 12 months as zeros so the chart always renders
    // a continuous x-axis (otherwise "quiet" months would silently
    // disappear and visually compress the timeline).
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
      byMonth[key] = 0
    }

    for (const r of rows) {
      const status = (r.lead_status || "new") as keyof typeof totals
      if (status in totals) (totals as any)[status]++
      byStatus[status] = (byStatus[status] || 0) + 1

      const focus = r.service_focus || "Unspecified"
      byFocus[focus] = (byFocus[focus] || 0) + 1

      const state = r.submitter_state || r.business_state || "Unknown"
      byState[state] = (byState[state] || 0) + 1

      // services_requested historically arrived in two shapes:
      // a JSON array of strings (current) and a single comma-separated
      // string (legacy). Normalize both.
      const sv = r.services_requested
      if (Array.isArray(sv)) {
        for (const s of sv) {
          if (s) byService[s] = (byService[s] || 0) + 1
        }
      } else if (typeof sv === "string" && sv.trim()) {
        for (const s of sv.split(/[;,]/).map((x) => x.trim()).filter(Boolean)) {
          byService[s] = (byService[s] || 0) + 1
        }
      }

      if (r.referral_source && r.referral_source.trim()) {
        const ref = r.referral_source.trim()
        byReferral[ref] = (byReferral[ref] || 0) + 1
      }

      if (r.preferred_team_member_id) {
        byProfessional[r.preferred_team_member_id] =
          (byProfessional[r.preferred_team_member_id] || 0) + 1
      }

      if (r.contact_id || r.organization_id) totals.linkedToClient++
      if (r.karbon_work_item_key) totals.withKarbonWorkItem++

      if (r.jotform_created_at) {
        const ts = new Date(r.jotform_created_at)
        if (!Number.isNaN(ts.getTime())) {
          if (ts >= monthStart) totals.thisMonth++
          if (ts >= last30Cutoff) totals.last30++
          const key = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, "0")}`
          // Only bump months that are inside our 12-month window;
          // older submissions inflate the running total but not the
          // chart series.
          if (key in byMonth) byMonth[key]++
        }
      }
    }

    // Resolve professional ids → display names so the client doesn't
    // have to make a second round-trip just to label the chart.
    const profIds = Object.keys(byProfessional)
    const professionalSeries: Array<{ id: string; name: string; count: number }> = []
    if (profIds.length > 0) {
      const { data: members } = await supabase
        .from("team_members")
        .select("id, full_name, first_name, last_name")
        .in("id", profIds)
      const nameById = new Map<string, string>()
      for (const m of members ?? []) {
        nameById.set(
          m.id,
          m.full_name || `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim() || "Unknown",
        )
      }
      for (const id of profIds) {
        professionalSeries.push({
          id,
          name: nameById.get(id) ?? "Unknown",
          count: byProfessional[id],
        })
      }
      professionalSeries.sort((a, b) => b.count - a.count)
    }

    // Convert maps → sorted arrays for chart-friendly consumption.
    const sortDesc = (m: Record<string, number>, max = 10) =>
      Object.entries(m)
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, max)

    const monthSeries = Object.entries(byMonth)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, count]) => ({ key, count }))

    return NextResponse.json({
      totals,
      byStatus: sortDesc(byStatus, 6),
      byFocus: sortDesc(byFocus, 6),
      byState: sortDesc(byState, 10),
      byService: sortDesc(byService, 10),
      byReferral: sortDesc(byReferral, 10),
      byMonth: monthSeries,
      byProfessional: professionalSeries.slice(0, 10),
    })
  } catch (err: any) {
    console.error("[v0] GET /api/jotform/intake/dashboard error:", err)
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 })
  }
}
