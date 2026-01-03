import { DashboardLayout } from "@/components/dashboard-layout"
import { ClientServicesDashboard } from "@/components/client-services-dashboard"

export default function ClientServicesPage() {
  return (
    <DashboardLayout>
      <ClientServicesDashboard />
    </DashboardLayout>
  )
}
