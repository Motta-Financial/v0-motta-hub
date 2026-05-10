import { DashboardLayout } from "@/components/dashboard-layout"
import { ProjectPlanView } from "@/components/project-plan/project-plan-view"
import { Badge } from "@/components/ui/badge"

// /accounting/bookkeeping is the sidebar shortcut to the Monthly Bookkeeping
// tab inside the Accounting Project Plan. It deep-links into the same
// ProjectPlanView the Accounting Dashboard renders, just opened on the
// checklist tab. Keeping a single underlying view means the Bookkeeping
// Checklist and the Monthly Bookkeeping Tracker are now literally the same
// component — same data, same filters, same Karbon-synced statuses.
export default function BookkeepingPage() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-3xl font-bold tracking-tight">Monthly Bookkeeping</h1>
            <Badge variant="outline" className="bg-blue-50 text-blue-800 border-blue-200">
              ACCT | Bookkeeping
            </Badge>
          </div>
          <p className="text-muted-foreground max-w-3xl">
            Pick a month, then a Karbon bookkeeping engagement, to update its 10-step
            checklist. Per-step progress is saved in Supabase; client, assignee, due
            date, and workflow status are pulled live from Karbon.
          </p>
        </div>
        <ProjectPlanView defaultTab="checklist" />
      </div>
    </DashboardLayout>
  )
}
