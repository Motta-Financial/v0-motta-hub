import { DashboardLayout } from "@/components/dashboard-layout"
import { TaxIndividualClient } from "@/components/tax/tax-individual-client"

export const dynamic = "force-dynamic"

export default function TaxIndividualPage() {
  return (
    <DashboardLayout>
      <TaxIndividualClient />
    </DashboardLayout>
  )
}
