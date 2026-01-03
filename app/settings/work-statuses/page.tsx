import { DashboardLayout } from "@/components/dashboard-layout"
import { WorkStatusManager } from "@/components/work-status-manager"

export default function WorkStatusesPage() {
  return (
    <DashboardLayout>
      <WorkStatusManager />
    </DashboardLayout>
  )
}
