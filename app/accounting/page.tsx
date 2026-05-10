import { DashboardLayout } from "@/components/dashboard-layout"
import { ProjectPlanView } from "@/components/project-plan/project-plan-view"
import { Badge } from "@/components/ui/badge"

// The Accounting Dashboard now renders the firm-wide multi-tab Project Plan
// directly (Dashboard, Team Workload, Client Roster, Timeline, Kanban,
// Monthly Bookkeeping). Previously this page had its own Overview /
// Monthly Bookkeeping / Onboarding tabs that drifted from the canonical
// Project Plan view and persisted per-task progress in localStorage — the
// Project Plan view is the single source of truth, Karbon-synced via
// /api/supabase/work-items (which mirrors Karbon) and per-step progress
// persisted in Supabase via /api/accounting/bookkeeping-checklist.
export default function AccountingPage() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-3xl font-bold tracking-tight">Accounting Dashboard</h1>
            <Badge variant="outline" className="bg-blue-50 text-blue-800 border-blue-200">
              Accounting (ACCT)
            </Badge>
          </div>
          <p className="text-muted-foreground max-w-3xl">
            Live view of every active Accounting work item (work_type beginning with
            &ldquo;ACCT | &rdquo; plus Outsourced NFP engagements) — Dashboard, Team
            Workload, Client Roster, Timeline, Kanban, and the unified Monthly
            Bookkeeping tracker with its 10-step checklist. Click any stat on the
            Dashboard to drill into the matching Roster or Kanban slice.
          </p>
        </div>
        <ProjectPlanView />
      </div>
    </DashboardLayout>
  )
}
