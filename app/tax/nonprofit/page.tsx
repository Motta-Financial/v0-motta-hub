import { DashboardLayout } from "@/components/dashboard-layout"
import { TaxNonprofitClient } from "@/components/tax/tax-nonprofit-client"

export const dynamic = "force-dynamic"

export default function TaxNonprofitPage() {
  return (
    <DashboardLayout>
      <TaxNonprofitClient />
    </DashboardLayout>
  )
}
