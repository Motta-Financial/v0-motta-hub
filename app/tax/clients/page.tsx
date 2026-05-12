import { DashboardLayout } from "@/components/dashboard-layout"
import { TaxClientsClient } from "@/components/tax/tax-clients-client"

export const dynamic = "force-dynamic"

export default function TaxClientsPage() {
  return (
    <DashboardLayout>
      <TaxClientsClient />
    </DashboardLayout>
  )
}
