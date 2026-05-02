/**
 * GET /api/ignition/stats
 *
 * Top-of-page numbers for the Ignition admin dashboard:
 *   - clients (total / matched / unmatched / no_match)
 *   - proposals (total + by status)
 *   - invoices (paid / outstanding / paid amount / outstanding amount)
 *   - webhook events in the last 24h (success / failed / skipped)
 *
 * One round-trip; everything aggregated DB-side via parallel selects.
 */
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"

export async function GET() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // Run aggregation queries in parallel — each one is a small COUNT that
  // hits an indexed column.
  const [
    clientsAll,
    clientsAuto,
    clientsManual,
    clientsUnmatched,
    clientsNoMatch,
    proposalsAll,
    proposalsAccepted,
    proposalsSent,
    proposalsLost,
    invoicesPaid,
    invoicesOutstanding,
    eventsRecent,
  ] = await Promise.all([
    supabase.from("ignition_clients").select("ignition_client_id", { count: "exact", head: true }),
    supabase.from("ignition_clients").select("ignition_client_id", { count: "exact", head: true }).eq("match_status", "auto_matched"),
    supabase.from("ignition_clients").select("ignition_client_id", { count: "exact", head: true }).eq("match_status", "manual_matched"),
    supabase.from("ignition_clients").select("ignition_client_id", { count: "exact", head: true }).in("match_status", ["unmatched", "manual_review"]),
    supabase.from("ignition_clients").select("ignition_client_id", { count: "exact", head: true }).eq("match_status", "no_match"),
    supabase.from("ignition_proposals").select("proposal_id", { count: "exact", head: true }),
    supabase.from("ignition_proposals").select("proposal_id", { count: "exact", head: true }).eq("status", "accepted"),
    supabase.from("ignition_proposals").select("proposal_id", { count: "exact", head: true }).eq("status", "sent"),
    supabase.from("ignition_proposals").select("proposal_id", { count: "exact", head: true }).eq("status", "lost"),
    supabase.from("ignition_invoices").select("ignition_invoice_id, amount", { count: "exact" }).eq("status", "paid"),
    supabase.from("ignition_invoices").select("ignition_invoice_id, amount_outstanding", { count: "exact" }).neq("status", "paid"),
    supabase.from("ignition_webhook_events").select("processing_status, event_type").gte("received_at", oneDayAgo),
  ])

  // Sum invoice amounts client-side from the (small) returned rows.
  const paidAmount = (invoicesPaid.data || []).reduce(
    (sum, r) => sum + (Number(r.amount) || 0),
    0,
  )
  const outstandingAmount = (invoicesOutstanding.data || []).reduce(
    (sum, r) => sum + (Number(r.amount_outstanding) || 0),
    0,
  )

  // Tally events by status
  const eventTally: Record<string, number> = { success: 0, failed: 0, skipped: 0, pending: 0 }
  for (const e of eventsRecent.data || []) {
    eventTally[e.processing_status] = (eventTally[e.processing_status] || 0) + 1
  }

  return NextResponse.json({
    clients: {
      total: clientsAll.count || 0,
      auto_matched: clientsAuto.count || 0,
      manual_matched: clientsManual.count || 0,
      unmatched: clientsUnmatched.count || 0,
      no_match: clientsNoMatch.count || 0,
    },
    proposals: {
      total: proposalsAll.count || 0,
      accepted: proposalsAccepted.count || 0,
      sent: proposalsSent.count || 0,
      lost: proposalsLost.count || 0,
    },
    invoices: {
      paid_count: invoicesPaid.count || 0,
      paid_amount: paidAmount,
      outstanding_count: invoicesOutstanding.count || 0,
      outstanding_amount: outstandingAmount,
    },
    webhooks_24h: {
      total: (eventsRecent.data || []).length,
      ...eventTally,
    },
  })
}
