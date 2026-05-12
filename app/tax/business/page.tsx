import { DashboardLayout } from "@/components/dashboard-layout"
import { TaxBusinessClient } from "@/components/tax/tax-business-client"

export const dynamic = "force-dynamic"

export default function TaxBusinessPage() {
  return (
    <DashboardLayout>
      <TaxBusinessClient />
    </DashboardLayout>
  )
}
