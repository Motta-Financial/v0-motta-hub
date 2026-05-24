import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { getClientProfile } from "@/lib/clients/profile"

/**
 * GET /api/clients/[id]/context
 *
 * ALFRED-friendly structured context for a Hub master client. Aggregates the
 * cached profile summary with a small slice of the most recent work items,
 * debriefs, proposals, invoices, and meetings — everything the assistant
 * needs to confirm identity AND answer questions about the relationship.
 *
 * The shape is the Hub-master mirror of /api/tax/clients/[clientId]/context.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  try {
    const supabase = createAdminClient()
    const profile = await getClientProfile(id)
    if (!profile) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 })
    }

    const refKey = profile.clientKind === "contact" ? "contact_id" : "organization_id"

    const [
      { data: workItems },
      { data: debriefs },
      { data: proposals },
      { data: kInv },
      { data: igInv },
      { data: calLinks },
      { data: zoomLinks },
    ] = await Promise.all([
      supabase
        .from("work_items")
        .select(
          "id, karbon_work_item_key, title, work_type, primary_status, secondary_status, due_date, assignee_name, fixed_fee_amount, actual_fee, estimated_fee, karbon_url, completed_date",
        )
        .eq(refKey, id)
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(10),
      supabase
        .from("debriefs")
        .select("id, debrief_date, debrief_type, notes, action_items, follow_up_date")
        .eq(refKey, id)
        .order("debrief_date", { ascending: false, nullsFirst: false })
        .limit(5),
      supabase
        .from("ignition_proposals")
        .select(
          "proposal_id, title, status, total_value, recurring_total, recurring_frequency, accepted_at, sent_at",
        )
        .eq(refKey, id)
        .order("sent_at", { ascending: false, nullsFirst: false })
        .limit(10),
      supabase
        .from("karbon_invoices")
        .select(
          "id, invoice_number, total_amount, status, issued_date, due_date, paid_date, work_item_title",
        )
        .eq(refKey, id)
        .order("issued_date", { ascending: false, nullsFirst: false })
        .limit(10),
      supabase
        .from("ignition_invoices")
        .select(
          "ignition_invoice_id, invoice_number, status, amount, amount_paid, amount_outstanding, invoice_date, due_date, paid_at",
        )
        .eq(refKey, id)
        .order("invoice_date", { ascending: false, nullsFirst: false })
        .limit(10),
      supabase
        .from("calendly_event_clients")
        .select("calendly_event_id, link_source")
        .eq(refKey, id),
      supabase
        .from("zoom_meeting_clients")
        .select("zoom_meeting_id, link_source")
        .eq(refKey, id),
    ])

    // Recent meetings (Calendly + Zoom merged)
    const calIds = (calLinks || []).map((r) => r.calendly_event_id).filter(Boolean)
    const zoomIds = (zoomLinks || []).map((r) => r.zoom_meeting_id).filter(Boolean)
    const [{ data: cal }, { data: zoom }] = await Promise.all([
      calIds.length
        ? supabase
            .from("calendly_events")
            .select("id, name, start_time, status, calendly_user_name")
            .in("id", calIds)
            .order("start_time", { ascending: false })
            .limit(10)
        : Promise.resolve({ data: [] as { id: string; name: string | null; start_time: string | null; status: string | null; calendly_user_name: string | null }[] }),
      zoomIds.length
        ? supabase
            .from("zoom_meetings")
            .select("id, topic, start_time, host_email, status")
            .in("id", zoomIds)
            .order("start_time", { ascending: false })
            .limit(10)
        : Promise.resolve({ data: [] as { id: string; topic: string | null; start_time: string | null; host_email: string | null; status: string | null }[] }),
    ])

    const recentMeetings = [
      ...((cal || []) as { id: string; name: string | null; start_time: string | null; status: string | null; calendly_user_name: string | null }[]).map(
        (e) => ({
          source: "calendly" as const,
          id: e.id,
          title: e.name,
          startTime: e.start_time,
          status: e.status,
          host: e.calendly_user_name,
        }),
      ),
      ...((zoom || []) as { id: string; topic: string | null; start_time: string | null; host_email: string | null; status: string | null }[]).map(
        (m) => ({
          source: "zoom" as const,
          id: m.id,
          title: m.topic,
          startTime: m.start_time,
          status: m.status,
          host: m.host_email,
        }),
      ),
    ]
      .filter((m) => m.startTime)
      .sort((a, b) => (a.startTime! < b.startTime! ? 1 : -1))
      .slice(0, 10)

    // Build the context payload
    const context = {
      // Identity
      identification: {
        clientId: profile.clientId,
        clientKind: profile.clientKind,
        displayName: profile.displayName,
        clientType: profile.clientType,
        isProspect: profile.isProspect,
        status: profile.status,
        legacyMottaClientId: profile.legacyMottaClientId,
        karbonContactKey: profile.karbonContactKey,
        karbonOrganizationKey: profile.karbonOrganizationKey,
        ignitionClientId: profile.ignitionClientId,
        proconnectClientId: profile.proconnectClientId,
        userDefinedIdentifier: profile.userDefinedIdentifier,
        primaryEmail: profile.primaryEmail,
        phonePrimary: profile.phonePrimary,
        location: [profile.city, profile.state].filter(Boolean).join(", ") || null,
      },

      // Owners
      owners: {
        clientOwner: profile.clientOwnerName,
        clientManager: profile.clientManagerName,
      },

      // Profile / AI summary
      profile: {
        summary: profile.aiSummary,
        keywords: profile.aiKeywords,
        completeness: profile.profileCompleteness,
        needsAttention: profile.needsAttention,
        attentionReasons: profile.attentionReasons,
        tags: profile.tags,
      },

      // Engagements / work items
      engagements: {
        totalWorkItems: profile.totalWorkItems,
        openWorkItems: profile.openWorkItems,
        completedWorkItems: profile.completedWorkItems,
        overdueWorkItems: profile.overdueWorkItems,
        activeWorkTypes: profile.activeWorkTypes,
        nextDue: profile.nextDueWorkItemTitle
          ? {
              title: profile.nextDueWorkItemTitle,
              date: profile.nextDueDate,
              workItemId: profile.nextDueWorkItemId,
            }
          : null,
        recent: (workItems || []).map((w) => ({
          id: w.id,
          title: w.title,
          workType: w.work_type,
          status: w.primary_status || w.secondary_status,
          dueDate: w.due_date,
          completedDate: w.completed_date,
          assignee: w.assignee_name,
          karbonUrl: w.karbon_url,
          fee:
            Number(w.actual_fee) ||
            Number(w.fixed_fee_amount) ||
            Number(w.estimated_fee) ||
            null,
        })),
      },

      // Debriefs
      debriefs: {
        total: profile.totalDebriefs,
        openActionItems: profile.openActionItems,
        last: profile.lastDebriefDate
          ? {
              id: profile.lastDebriefId,
              date: profile.lastDebriefDate,
              type: profile.lastDebriefType,
              notes: profile.lastDebriefNotes,
            }
          : null,
        recent: (debriefs || []).map((d) => ({
          id: d.id,
          date: d.debrief_date,
          type: d.debrief_type,
          notes: d.notes ? d.notes.slice(0, 500) : null,
          followUpDate: d.follow_up_date,
          actionItemCount:
            (d.action_items as { items?: unknown[] } | null)?.items?.length || 0,
        })),
      },

      // Communications
      communications: {
        totalCalendlyEvents: profile.totalCalendlyEvents,
        totalZoomMeetings: profile.totalZoomMeetings,
        lastMeetingAt: profile.lastMeetingAt,
        nextMeetingAt: profile.nextMeetingAt,
        recent: recentMeetings,
      },

      // Financial: proposals
      proposals: {
        total: profile.totalProposals,
        active: profile.activeProposals,
        totalValue: profile.proposalsTotalValue,
        recurringTotal: profile.proposalsRecurringTotal,
        recurringFrequency: profile.recurringFrequency,
        recent: (proposals || []).map((p) => ({
          id: p.proposal_id,
          title: p.title,
          status: p.status,
          totalValue: Number(p.total_value) || 0,
          recurringTotal: Number(p.recurring_total) || 0,
          recurringFrequency: p.recurring_frequency,
          sentAt: p.sent_at,
          acceptedAt: p.accepted_at,
        })),
      },

      // Financial: invoices
      invoices: {
        total: profile.totalInvoices,
        totalBilled: profile.invoicesTotal,
        totalPaid: profile.invoicesPaid,
        outstanding: profile.invoicesOutstanding,
        lastInvoiceDate: profile.lastInvoiceDate,
        lastPaymentDate: profile.lastPaymentDate,
        lifetimeRevenue: profile.lifetimeRevenue,
        recent: [
          ...(kInv || []).map((i) => ({
            source: "karbon" as const,
            id: i.id,
            number: i.invoice_number,
            status: i.status,
            amount: Number(i.total_amount) || 0,
            issuedDate: i.issued_date,
            dueDate: i.due_date,
            paidDate: i.paid_date,
            workItemTitle: i.work_item_title,
          })),
          ...(igInv || []).map((i) => ({
            source: "ignition" as const,
            id: i.ignition_invoice_id,
            number: i.invoice_number,
            status: i.status,
            amount: Number(i.amount) || 0,
            amountPaid: Number(i.amount_paid) || 0,
            amountOutstanding: Number(i.amount_outstanding) || 0,
            issuedDate: i.invoice_date,
            dueDate: i.due_date,
            paidDate: i.paid_at,
          })),
        ]
          .sort((a, b) => {
            const ad = a.issuedDate || ""
            const bd = b.issuedDate || ""
            return ad < bd ? 1 : -1
          })
          .slice(0, 10),
      },

      metadata: {
        profileComputedAt: profile.computedAt,
        profileStale: !!profile.staleAt,
      },
    }

    return NextResponse.json(context)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[v0] /api/clients/[id]/context error:", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
