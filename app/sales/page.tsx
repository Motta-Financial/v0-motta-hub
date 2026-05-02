import { DashboardLayout } from "@/components/dashboard-layout"
import { SalesOverview } from "@/components/sales-overview"

export const metadata = {
  title: "Sales | Motta Hub",
  description: "Sales hub: dashboard, proposals, invoices, and the service catalog",
}

export default function SalesPage() {
  return (
    <DashboardLayout>
      <SalesOverview />
    </DashboardLayout>
  )
}
