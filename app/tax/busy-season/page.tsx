import { DashboardLayout } from "@/components/dashboard-layout"
import { BusySeasonTracker } from "@/components/busy-season-tracker"

export default function BusySeasonPage() {
  return (
    <DashboardLayout>
      <BusySeasonTracker />
    </DashboardLayout>
  )
}
