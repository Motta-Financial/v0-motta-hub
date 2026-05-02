import { DashboardLayout } from "@/components/dashboard-layout"
import { SalesServices } from "@/components/sales-services"

export const metadata = {
  title: "Services | Motta Hub",
  description: "Ignition service catalog with usage and revenue metrics",
}

export default function SalesServicesPage() {
  return (
    <DashboardLayout>
      <SalesServices />
    </DashboardLayout>
  )
}
