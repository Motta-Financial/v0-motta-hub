import { DashboardLayout } from "@/components/dashboard-layout"
import { SalesOverview } from "@/components/sales-overview"

export const metadata = {
  title: "Sales | ALFRED Hub",
  description:
    "Sales hub: dashboard, proposals, invoices, recurring revenue, payment links, intake, and the service catalog",
}

export default function SalesPage() {
  return (
    <DashboardLayout>
      <SalesOverview />
    </DashboardLayout>
  )
}
