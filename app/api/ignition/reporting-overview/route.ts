/**
 * GET /api/ignition/reporting-overview
 *
 * Read-only snapshot of the Reporting-API-backed tables that don't have
 * their own dedicated UI yet. Powers the "Reporting Data" tab on the
 * Ignition admin page so users can confirm contacts / deals / pipeline
 * stages / payment transactions / disbursals are actually being pulled in.
 *
 * Shape:
 *   {
 *     contacts: { total, recent: [{ ignition_contact_id, full_name, email, ignition_client_id, created_at }] }
 *     deals: {
 *       total,
 *       byStage: [{ stage_id, stage_name, pipeline_name, count, sort_order }],
 *       recent: [{ deal_id, deal_name, stage_name, ignition_client_id, value_amount, currency, status, updated_at }]
 *     }
 *     dealStages: { total, stages: [{ stage_id, name, pipeline_name, sort_order }] }
 *     paymentTransactions: { total, recent: [{ transaction_id, transaction_type, gross_amount, fees, net_amount, payment_date }] }
 *     disbursals: { total, recent: [{ disbursal_id, amount, currency, status, disbursal_date }] }
 *   }
 *
 * All sections are bounded to at most 25 recent rows so the response stays
 * small — this is a snapshot, not a list view.
 */
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers"

export const runtime = "nodejs"

const RECENT_LIMIT = 25

export async function GET() {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await getAuthenticatedUser(supabase)
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

    // Fan out all reads in parallel — every query is bounded and indexed.
    const [
      contactsCount,
      contactsRecent,
      dealsCount,
      dealsByStageRows,
      dealsRecent,
      dealStagesAll,
      txCount,
      txRecent,
      disbCount,
      disbRecent,
    ] = await Promise.all([
      supabase
        .from("ignition_contacts")
        .select("ignition_contact_id", { count: "exact", head: true }),
      supabase
        .from("ignition_contacts")
        .select("ignition_contact_id, full_name, email, ignition_client_id, created_at")
        .order("created_at", { ascending: false })
        .limit(RECENT_LIMIT),
      supabase.from("ignition_deals").select("ignition_deal_id", { count: "exact", head: true }),
      // Aggregating deals by stage in JS is fine — there are only a handful
      // of stages and dozens of deals. Saves us a stored function.
      supabase.from("ignition_deals").select("ignition_stage_id, stage_name"),
      supabase
        .from("ignition_deals")
        .select(
          "ignition_deal_id, title, stage_name, ignition_client_id, value, currency, status, last_event_at, updated_at",
        )
        .order("last_event_at", { ascending: false, nullsFirst: false })
        .limit(RECENT_LIMIT),
      supabase
        .from("ignition_deal_stages")
        .select("ignition_stage_id, name, pipeline_name, sort_order")
        .order("pipeline_name", { ascending: true })
        .order("sort_order", { ascending: true }),
      supabase
        .from("ignition_payment_transactions")
        .select("transaction_id", { count: "exact", head: true }),
      supabase
        .from("ignition_payment_transactions")
        .select(
          "transaction_id, transaction_type, gross_amount, fees, net_amount, currency, payment_date",
        )
        .order("payment_date", { ascending: false, nullsFirst: false })
        .limit(RECENT_LIMIT),
      supabase
        .from("ignition_disbursals")
        .select("disbursal_id", { count: "exact", head: true }),
      supabase
        .from("ignition_disbursals")
        .select("disbursal_id, total_amount, currency, state, arrival_date")
        .order("arrival_date", { ascending: false, nullsFirst: false })
        .limit(RECENT_LIMIT),
    ])

    // Join the deal stage info onto the byStage tally. We do the join here
    // (rather than in the SQL) because the stages table is tiny (9 rows).
    const stageById = new Map<
      string,
      { name: string; pipeline_name: string; sort_order: number }
    >()
    for (const s of dealStagesAll.data || []) {
      stageById.set(s.ignition_stage_id, {
        name: s.name,
        pipeline_name: s.pipeline_name,
        sort_order: s.sort_order ?? 0,
      })
    }
    const stageTallies = new Map<
      string,
      {
        stage_id: string
        stage_name: string
        pipeline_name: string
        sort_order: number
        count: number
      }
    >()
    for (const d of dealsByStageRows.data || []) {
      // Key by ignition_stage_id when present, fall back to stage_name so
      // deals with a NULL ignition_stage_id (legacy/manual rows) still get
      // bucketed.
      const key = d.ignition_stage_id || `name:${d.stage_name ?? "unknown"}`
      const existing = stageTallies.get(key)
      if (existing) {
        existing.count += 1
      } else {
        const enriched = d.ignition_stage_id ? stageById.get(d.ignition_stage_id) : null
        stageTallies.set(key, {
          stage_id: d.ignition_stage_id ?? "",
          stage_name: enriched?.name ?? d.stage_name ?? "Unknown",
          pipeline_name: enriched?.pipeline_name ?? "—",
          sort_order: enriched?.sort_order ?? 999,
          count: 1,
        })
      }
    }
    const dealsByStage = Array.from(stageTallies.values()).sort((a, b) => {
      if (a.pipeline_name !== b.pipeline_name) return a.pipeline_name.localeCompare(b.pipeline_name)
      return a.sort_order - b.sort_order
    })

    // Normalize column names from DB to a stable response shape so the UI
    // doesn't need to know about Ignition's quirky field naming (title vs
    // deal_name, value vs amount, state vs status, etc.). If we ever rename
    // a column, only this mapper needs to change.
    return NextResponse.json({
      contacts: {
        total: contactsCount.count || 0,
        recent: contactsRecent.data || [],
      },
      deals: {
        total: dealsCount.count || 0,
        byStage: dealsByStage,
        recent: (dealsRecent.data || []).map((d) => ({
          deal_id: d.ignition_deal_id,
          deal_name: d.title,
          stage_name: d.stage_name,
          ignition_client_id: d.ignition_client_id,
          value_amount: d.value,
          currency: d.currency,
          status: d.status,
          updated_at: d.last_event_at ?? d.updated_at,
        })),
      },
      dealStages: {
        total: (dealStagesAll.data || []).length,
        stages: (dealStagesAll.data || []).map((s) => ({
          stage_id: s.ignition_stage_id,
          name: s.name,
          pipeline_name: s.pipeline_name,
          sort_order: s.sort_order,
        })),
      },
      paymentTransactions: {
        total: txCount.count || 0,
        recent: txRecent.data || [],
      },
      disbursals: {
        total: disbCount.count || 0,
        recent: (disbRecent.data || []).map((d) => ({
          disbursal_id: d.disbursal_id,
          amount: d.total_amount,
          currency: d.currency,
          status: d.state,
          disbursal_date: d.arrival_date,
        })),
      },
    })
  } catch (error) {
    console.error("[ignition/reporting-overview] Error:", error)
    return NextResponse.json({ error: "Failed to load reporting overview" }, { status: 500 })
  }
}
