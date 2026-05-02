import { DashboardLayout } from "@/components/dashboard-layout"
import { SalesDashboard } from "@/components/sales-dashboard"

export const metadata = {
  title: "Sales Dashboard | Motta Hub",
  description: "Pipeline, won deals, services, and geographic breakdown across Ignition proposals",
}

export default function SalesPage() {
  return (
    <DashboardLayout>
      <SalesDashboard />
    </DashboardLayout>
  )
}
