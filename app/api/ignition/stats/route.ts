/**
 * GET /api/ignition/stats
 *
 * Drives the Ignition admin page header + activity feed.
 *
 * Shape (matches what the page consumes — see app/admin/ignition/page.tsx):
 *   {
 *     totals: { clients, matched, unmatched, proposals, invoices, payments }
 *     matchBreakdown: [{ method, count, avg_confidence }]
 *     recentEvents:   [{ event_type, processing_status, received_at, processing_error }]
 *   }
 *
 * "matched" counts BOTH auto_matched AND manual_matched — anything where the
 * Ignition client is linked to a real Karbon contact/organization. Anything
 * needing human review (unmatched, manual_review) lands in "unmatched".
 */
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"

export async function GET() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  // Run all aggregates in parallel; each is a tiny indexed COUNT or a
  // small bounded SELECT. p95 should be well under 100ms.
  const [
    clientsTotal,
    clientsMatched,
    clientsUnmatched,
    proposalsTotal,
    invoicesTotal,
    paymentsTotal,
    matchBreakdownRows,
    recentEventRows,
  ] = await Promise.all([
    supabase.from("ignition_clients").select("ignition_client_id", { count: "exact", head: true }),
    // Auto + manual confirmed matches both count as "matched" for the
    // headline "X% mapped" stat.
    supabase
      .from("ignition_clients")
      .select("ignition_client_id", { count: "exact", head: true })
      .in("match_status", ["matched", "auto_matched", "manual_matched"]),
    // "Needs review" bucket — what shows up in the unmatched queue.
    supabase
      .from("ignition_clients")
      .select("ignition_client_id", { count: "exact", head: true })
      .in("match_status", ["unmatched", "manual_review"]),
    supabase.from("ignition_proposals").select("proposal_id", { count: "exact", head: true }),
    supabase
      .from("ignition_invoices")
      .select("ignition_invoice_id", { count: "exact", head: true }),
    supabase
      .from("ignition_payments")
      .select("ignition_payment_id", { count: "exact", head: true }),
    // Match-method breakdown for the "How clients were matched" card.
    supabase
      .from("ignition_clients")
      .select("match_method, match_confidence")
      .not("match_method", "is", null),
    // Last 50 events for the activity feed. Index on received_at DESC.
    supabase
      .from("ignition_webhook_events")
      .select("event_type, processing_status, received_at, processing_error")
      .order("received_at", { ascending: false })
      .limit(50),
  ])

  // Tally match methods client-side (the table is small — at most a few
  // hundred rows total).
  const breakdownMap = new Map<string, { count: number; sum: number }>()
  for (const row of matchBreakdownRows.data || []) {
    const method = row.match_method as string
    const conf = Number(row.match_confidence) || 0
    const existing = breakdownMap.get(method) || { count: 0, sum: 0 }
    existing.count += 1
    existing.sum += conf
    breakdownMap.set(method, existing)
  }
  const matchBreakdown = Array.from(breakdownMap.entries())
    .map(([method, v]) => ({
      method,
      count: v.count,
      avg_confidence: v.count > 0 ? v.sum / v.count : 0,
    }))
    .sort((a, b) => b.count - a.count)

  return NextResponse.json({
    totals: {
      clients: clientsTotal.count || 0,
      matched: clientsMatched.count || 0,
      unmatched: clientsUnmatched.count || 0,
      proposals: proposalsTotal.count || 0,
      invoices: invoicesTotal.count || 0,
      payments: paymentsTotal.count || 0,
    },
    matchBreakdown,
    recentEvents: recentEventRows.data || [],
  })
}
