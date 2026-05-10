import { DashboardLayout } from "@/components/dashboard-layout"
import { BookkeepingDashboard } from "@/components/bookkeeping/bookkeeping-dashboard"
import { Badge } from "@/components/ui/badge"

// /accounting/bookkeeping is the firm's dedicated dashboard for the
// Monthly Accounting & Bookkeeping book of business. Previously this
// page just delegated to <ProjectPlanView defaultTab="checklist" />,
// which only gave users a picker + a 10-step checklist editor — useful
// but not a true dashboard.
//
// The Accounting Dashboard at /accounting still renders the ACCT-wide
// Project Plan (Dashboard / Team Workload / Client Roster / Timeline /
// Kanban / Monthly Bookkeeping tab). This page narrows to the
// bookkeeping sub-service and layers on the views that are most useful
// when a partner is specifically working through the monthly close:
//
//   - Per-month KPIs (engagements, distinct clients, avg checklist
//     completion %, at-risk count)
//   - Karbon workflow-status breakdown + per-lead workload, both
//     click-to-filter
//   - FY-wide coverage matrix (client × month) colored by status
//   - Engagement list where every row expands inline to the 10-step
//     checklist (driven by the same ChecklistForWorkItem component the
//     Project Plan tab uses, so the two views can never drift apart)
//   - At-risk panel (overdue + waiting-on-client engagements)
//
// All data is live and Karbon-synced via useAccountingWorkItems(); per-
// step checklist progress is persisted in Supabase via
// /api/accounting/bookkeeping-checklist (single) and
// /api/accounting/bookkeeping-checklist/summary (bulk, used here).
export default function BookkeepingPage() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-3xl font-bold tracking-tight">
              Monthly Bookkeeping
            </h1>
            <Badge variant="outline" className="bg-blue-50 text-blue-800 border-blue-200">
              ACCT | Bookkeeping
            </Badge>
          </div>
          <p className="text-muted-foreground max-w-3xl">
            End-to-end dashboard for the firm&apos;s recurring monthly accounting
            engagements. Pick a month to see live KPIs, status &amp; lead breakdowns,
            an FY coverage matrix, and a full engagement list — each row drops
            down to the 10-step checklist (Phase 1: P24 preparer; Phase 2: Andrew
            / Caleb / Amy / Matt review). Karbon work item, assignee, due date,
            and workflow status are pulled live from Karbon; per-step progress
            is saved in Supabase.
          </p>
        </div>
        <BookkeepingDashboard />
      </div>
    </DashboardLayout>
  )
}
