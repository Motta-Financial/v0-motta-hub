import { DashboardLayout } from "@/components/dashboard-layout"
import { TaxReturnsClient } from "@/components/tax/tax-returns-client"

export const dynamic = "force-dynamic"

export default function TaxReturnsPage() {
  return (
    <DashboardLayout>
      <TaxReturnsClient />
    </DashboardLayout>
  )
}
