import { DashboardLayout } from "@/components/dashboard-layout"
import { ProjectPlanView } from "@/components/project-plan/project-plan-view"
import { Badge } from "@/components/ui/badge"

// Firm-wide project plan view that mirrors the FY2026 Excel workbook the
// Accounting team has been maintaining manually. It pulls every active
// Karbon work item (across Accounting, Tax, Special Teams, Internal Ops,
// etc.) so we can retire the Excel file and drive the same dashboards from
// live Supabase data. Lives under /accounting because the workbook is
// owned by Accounting Ops, but the data scope is firm-wide by design.
export default function AccountingProjectPlanPage() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-bold tracking-tight">Project Plan</h1>
              <Badge variant="outline" className="bg-blue-50 text-blue-800 border-blue-200">
                Firm-wide
              </Badge>
            </div>
            <p className="text-muted-foreground max-w-3xl">
              Live replacement for the FY2026 project-plan workbook — every active work item
              across the firm with status, service type, team workload, timeline, kanban, and the
              10-step Bookkeeping Checklist.
            </p>
          </div>
        </div>
        <ProjectPlanView />
      </div>
    </DashboardLayout>
  )
}
