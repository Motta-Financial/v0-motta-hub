import { DashboardLayout } from "@/components/dashboard-layout"
import { SalesProposals } from "@/components/sales-proposals"

export const metadata = {
  title: "Proposals | Motta Hub",
  description: "Browse, filter, and search every Ignition proposal",
}

export default function SalesProposalsPage() {
  return (
    <DashboardLayout>
      <SalesProposals />
    </DashboardLayout>
  )
}
