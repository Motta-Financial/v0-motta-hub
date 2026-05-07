import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"

/**
 * GET /api/departments/accounting/onboarding
 *
 * Returns every Karbon work item under the "ACCT | Onboarding" umbrella —
 * today that's two distinct work_types in Karbon:
 *
 *   • ACCT | Onboarding (BKPG)   — bookkeeping onboarding
 *   • ACCT | Onboarding (PYRL)   — payroll onboarding
 *
 * For each one we surface the canonical Karbon fields the team cares
 * about (status, workflow status, period, assignee, manager, partner,
 * todo counts, fees, dates, the deep-link `karbon_url`) plus any
 * Ignition proposals we can match by client name. The match is
 * intentionally lenient — Karbon keeps client names in
 * `org_name / client_name / contact_full_name` and Ignition stores them
 * on `ignition_proposals.client_name`, so we case-fold and try the
 * obvious candidates rather than insisting on a perfect contact-id link
 * that the upstream syncs don't yet guarantee. Any work item with at
 * least one proposal hit will list them in the returned `proposals[]`.
 *
 * Query params (all optional):
 *   • includeCompleted=true   — keep "Completed" / "Cancelled" rows
 *   • phase=BKPG|PYRL|QBO     — comma-separated, filters by work-type
 *                               variant (matches the suffix in
 *                               parentheses)
 *   • status=...              — comma-separated workflow statuses
 *   • assignee=...            — comma-separated assignee_name values
 *   • search=...              — case-insensitive contains across
 *                               title / client_name / org_name
 *
 * The response is shaped for the dashboard card UI: one rich
 * workItems[] array, plus a `summary` object with rollup counts/values
 * and a `dimensions` object the chip rail uses to populate dropdowns
 * (statuses / phases / assignees that *actually appear* in the data).
 */

// Karbon stores onboarding work types with the variant in parentheses
// (e.g. "ACCT | Onboarding (BKPG)"). We use a `LIKE 'ACCT | Onboarding%'`
// match rather than enumerating known values so a future variant (e.g.
// "ACCT | Onboarding (Tax)") will be picked up automatically.
const ONBOARDING_WORK_TYPE_PREFIX = "ACCT | Onboarding"

type OnboardingPhase = "BKPG" | "PYRL" | "QBO" | "OTHER"

interface ProposalLink {
  proposal_id: string
  proposal_number: string | null
  title: string | null
  status: string | null
  total_value: number | null
  recurring_total: number | null
  one_time_total: number | null
  signed_url: string | null
  accepted_at: string | null
  completed_at: string | null
  sent_at: string | null
  client_name: string | null
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)

    const includeCompleted = searchParams.get("includeCompleted") === "true"
    const phaseFilter = (searchParams.get("phase") || "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
    const statusFilter = (searchParams.get("status") || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
    const assigneeFilter = (searchParams.get("assignee") || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
    const search = (searchParams.get("search") || "").trim().toLowerCase()

    // ─── 1. Pull work items ────────────────────────────────────────────
    // We pull from `work_items_enriched`, the read-side view that
    // already joins assignee / manager / partner / org / contact names
    // onto each row. Limit is generous (we only have ~150 onboarding
    // items today) so the dashboard can do all filtering client-side
    // without paginating.
    // Hand-rolled row shape so we can keep autocomplete inside the
    // mapper without dragging in the project's full generated Supabase
    // types (the enriched view isn't in the typed Database yet).
    type EnrichedRow = {
      id: string
      karbon_work_item_key: string | null
      title: string | null
      description: string | null
      work_type: string | null
      status: string | null
      workflow_status: string | null
      primary_status: string | null
      secondary_status: string | null
      priority: string | null
      start_date: string | null
      due_date: string | null
      completed_date: string | null
      period_start: string | null
      period_end: string | null
      tax_year: number | null
      client_type: string | null
      client_name: string | null
      contact_full_name: string | null
      org_name: string | null
      client_group_name: string | null
      assignee_name: string | null
      manager_full_name: string | null
      owner_full_name: string | null
      client_manager_name: string | null
      client_partner_name: string | null
      todo_count: number | null
      completed_todo_count: number | null
      has_blocking_todos: boolean | null
      fee_type: string | null
      fixed_fee_amount: number | null
      estimated_fee: number | null
      actual_fee: number | null
      budget_hours: number | null
      actual_hours: number | null
      karbon_url: string | null
      karbon_modified_at: string | null
      karbon_created_at: string | null
      deleted_in_karbon_at: string | null
    }

    const { data: rows, error } = await supabase
      .from("work_items_enriched")
      .select(
        "id, karbon_work_item_key, title, description, work_type, status, workflow_status, primary_status, secondary_status, priority, start_date, due_date, completed_date, period_start, period_end, tax_year, client_type, client_name, contact_full_name, org_name, client_group_name, assignee_name, manager_full_name, owner_full_name, client_manager_name, client_partner_name, todo_count, completed_todo_count, has_blocking_todos, fee_type, fixed_fee_amount, estimated_fee, actual_fee, budget_hours, actual_hours, karbon_url, karbon_modified_at, karbon_created_at, deleted_in_karbon_at",
      )
      .ilike("work_type", `${ONBOARDING_WORK_TYPE_PREFIX}%`)
      .is("deleted_in_karbon_at", null)
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(500)
      .returns<EnrichedRow[]>()
    if (error) {
      console.error("[v0] onboarding API error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const allRows = rows ?? []

    // ─── 2. Build proposal lookup ─────────────────────────────────────
    // Pull every Ignition proposal once and bucket them by lower-cased
    // client name. With ~900 proposals total this is a single round-trip
    // and avoids N+1 lookups inside the work-item loop. We deliberately
    // keep cancelled / lost proposals in the index so the UI can show
    // historical attempts (the surface decides whether to render them).
    const { data: proposals } = await supabase
      .from("ignition_proposals")
      .select(
        "proposal_id, proposal_number, title, status, total_value, recurring_total, one_time_total, signed_url, accepted_at, completed_at, sent_at, client_name",
      )
      .order("sent_at", { ascending: false, nullsFirst: false })
    const proposalsByClient = new Map<string, ProposalLink[]>()
    for (const p of proposals || []) {
      const key = (p.client_name || "").trim().toLowerCase()
      if (!key) continue
      const arr = proposalsByClient.get(key) ?? []
      arr.push(p as ProposalLink)
      proposalsByClient.set(key, arr)
    }

    // ─── 3. Shape rows ────────────────────────────────────────────────
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const enriched = allRows.map((r) => {
      // Parse the variant out of "ACCT | Onboarding (BKPG)" → "BKPG".
      // Any unmatched suffix collapses to "OTHER" so future Karbon
      // variants don't crash the type-narrow.
      const variantMatch = (r.work_type || "").match(/\(([^)]+)\)\s*$/)
      const phase: OnboardingPhase = (() => {
        const v = (variantMatch?.[1] || "").toUpperCase()
        if (v === "BKPG" || v === "PYRL" || v === "QBO") return v
        return "OTHER"
      })()

      // Resolve the displayed client name. Prefer the explicit
      // organization or contact name from the join, then any client_name
      // sync field, then the work-item's group name as a last resort.
      const displayClientName =
        r.org_name ||
        r.contact_full_name ||
        r.client_name ||
        r.client_group_name ||
        "Unknown Client"

      const lookupKey = displayClientName.trim().toLowerCase()
      const matchedProposals = (proposalsByClient.get(lookupKey) || []).slice(0, 6)

      // Days-until-due is convenient for the UI to colour the chip; we
      // compute it server-side so SWR-cached responses don't drift if a
      // tab sits open across midnight.
      let daysUntilDue: number | null = null
      let isOverdue = false
      if (r.due_date) {
        const dd = new Date(r.due_date)
        if (!isNaN(dd.getTime())) {
          const diffMs = dd.getTime() - today.getTime()
          daysUntilDue = Math.round(diffMs / (1000 * 60 * 60 * 24))
          isOverdue =
            daysUntilDue < 0 &&
            !((r.status || "").toLowerCase().includes("complete"))
        }
      }

      const todoTotal = r.todo_count ?? 0
      const todoDone = r.completed_todo_count ?? 0
      const todoProgress =
        todoTotal > 0 ? Math.round((todoDone / todoTotal) * 100) : null

      return {
        id: r.id,
        karbon_work_item_key: r.karbon_work_item_key,
        title: r.title,
        description: r.description,
        work_type: r.work_type,
        phase,
        status: r.status || r.primary_status || r.workflow_status || "Unknown",
        workflow_status: r.workflow_status,
        primary_status: r.primary_status,
        secondary_status: r.secondary_status,
        priority: r.priority,
        start_date: r.start_date,
        due_date: r.due_date,
        completed_date: r.completed_date,
        period_start: r.period_start,
        period_end: r.period_end,
        tax_year: r.tax_year,
        client_type: r.client_type,
        client_name: displayClientName,
        client_group_name: r.client_group_name,
        assignee_name: r.assignee_name,
        manager_name: r.client_manager_name || r.manager_full_name,
        partner_name: r.client_partner_name,
        owner_name: r.owner_full_name,
        todo_count: todoTotal,
        completed_todo_count: todoDone,
        todo_progress: todoProgress,
        has_blocking_todos: r.has_blocking_todos ?? false,
        fee_type: r.fee_type,
        fixed_fee_amount: r.fixed_fee_amount,
        estimated_fee: r.estimated_fee,
        actual_fee: r.actual_fee,
        budget_hours: r.budget_hours,
        actual_hours: r.actual_hours,
        karbon_url: r.karbon_url,
        karbon_modified_at: r.karbon_modified_at,
        karbon_created_at: r.karbon_created_at,
        days_until_due: daysUntilDue,
        is_overdue: isOverdue,
        proposals: matchedProposals,
      }
    })

    // ─── 4. Apply filters ─────────────────────────────────────────────
    const filtered = enriched.filter((w) => {
      const statusLower = (w.status || "").toLowerCase()
      if (!includeCompleted) {
        if (statusLower.includes("complete") || statusLower.includes("cancel"))
          return false
      }
      if (phaseFilter.length && !phaseFilter.includes(w.phase)) return false
      if (statusFilter.length && !statusFilter.includes(statusLower)) return false
      if (
        assigneeFilter.length &&
        !assigneeFilter.includes((w.assignee_name || "").toLowerCase())
      ) {
        return false
      }
      if (search) {
        const haystack = [
          w.title,
          w.client_name,
          w.client_group_name,
          w.assignee_name,
          w.manager_name,
          w.partner_name,
          w.karbon_work_item_key,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
        if (!haystack.includes(search)) return false
      }
      return true
    })

    // ─── 5. Build summary + dimensions ────────────────────────────────
    const byStatus: Record<string, number> = {}
    const byPhase: Record<string, number> = { BKPG: 0, PYRL: 0, QBO: 0, OTHER: 0 }
    let overdueCount = 0
    let withProposalCount = 0
    let estimatedFeeTotal = 0
    let actualFeeTotal = 0
    for (const w of filtered) {
      byStatus[w.status] = (byStatus[w.status] ?? 0) + 1
      byPhase[w.phase] = (byPhase[w.phase] ?? 0) + 1
      if (w.is_overdue) overdueCount++
      if (w.proposals.length > 0) withProposalCount++
      estimatedFeeTotal += Number(w.estimated_fee ?? w.fixed_fee_amount ?? 0)
      actualFeeTotal += Number(w.actual_fee ?? 0)
    }

    // The dimensions block reflects the *unfiltered* dataset so toggling
    // a chip never removes options that the user might want to add back.
    // (Same convention used by the proposals + services dashboards.)
    const dimensions = {
      statuses: Array.from(new Set(enriched.map((w) => w.status))).sort(),
      phases: Array.from(
        new Set(enriched.map((w) => w.phase as string)),
      ).sort(),
      assignees: Array.from(
        new Set(
          enriched
            .map((w) => w.assignee_name)
            .filter((n): n is string => !!n && n.trim().length > 0),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    }

    return NextResponse.json({
      workItems: filtered,
      summary: {
        total: filtered.length,
        totalUnfiltered: enriched.length,
        byStatus,
        byPhase,
        overdueCount,
        withProposalCount,
        estimatedFeeTotal,
        actualFeeTotal,
      },
      dimensions,
    })
  } catch (err) {
    console.error("[v0] onboarding API uncaught:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load onboarding data" },
      { status: 500 },
    )
  }
}
