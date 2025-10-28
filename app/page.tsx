import { DashboardLayout } from "@/components/dashboard-layout"
import { DashboardHome } from "@/components/dashboard-home"
import { AlfredInsightsBanner } from "@/components/alfred-insights-banner"

export default function Page() {
  return (
    <DashboardLayout>
      <AlfredInsightsBanner />
      <DashboardHome />
    </DashboardLayout>
  )
}
