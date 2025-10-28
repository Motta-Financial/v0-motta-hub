import { DashboardLayout } from "@/components/dashboard-layout"
import { WorkItemsView } from "@/components/work-items-view"

export default function WorkItemsPage() {
  return (
    <DashboardLayout>
      <WorkItemsView />
    </DashboardLayout>
  )
}
