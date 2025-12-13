import { DashboardLayout } from "@/components/dashboard-layout"
import { BookkeepingTracker } from "@/components/bookkeeping-tracker"

export default function BookkeepingPage() {
  return (
    <DashboardLayout>
      <BookkeepingTracker />
    </DashboardLayout>
  )
}
