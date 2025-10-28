import { DashboardLayout } from "@/components/dashboard-layout"
import { ClientsList } from "@/components/clients-list"

export default function ClientsPage() {
  return (
    <DashboardLayout>
      <ClientsList />
    </DashboardLayout>
  )
}
