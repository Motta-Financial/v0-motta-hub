import { DashboardLayout } from "@/components/dashboard-layout"
import { ProjectPlanView } from "@/components/project-plan/project-plan-view"
import { Badge } from "@/components/ui/badge"

// Accounting project plan view that mirrors the FY2026 Excel workbook the
// Accounting team has been maintaining manually. Scoped strictly to
// Karbon work items whose work_type begins with "ACCT | " (Bookkeeping,
// Payroll, 1099s, FP&A, Onboarding, Quarterly Filings, etc.) so the
// numbers reconcile back to the source workbook — the firm-wide view
// lives elsewhere. The ACCT filter is centralized in
// useAccountingWorkItems() so every tab shares the same scope.
export default function AccountingProjectPlanPage() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-bold tracking-tight">Project Plan</h1>
              <Badge variant="outline" className="bg-blue-50 text-blue-800 border-blue-200">
                Accounting (ACCT)
              </Badge>
            </div>
            <p className="text-muted-foreground max-w-3xl">
              Live replacement for the FY2026 project-plan workbook — every active Accounting
              work item (work_type beginning with &ldquo;ACCT | &rdquo;) with status, service
              type, team workload, timeline, kanban, and the 10-step Bookkeeping Checklist.
              Click any stat in the Dashboard to drill into the matching Roster or Kanban view.
            </p>
          </div>
        </div>
        <ProjectPlanView />
      </div>
    </DashboardLayout>
  )
}
