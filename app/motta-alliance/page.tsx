import { DashboardLayout } from "@/components/dashboard-layout"
import { MottaAlliance } from "@/components/motta-alliance/motta-alliance"

export const metadata = {
  title: "Motta Alliance | Motta Financial",
  description:
    "The Motta Alliance — an internal comic-book series chronicling the firm's heroes fighting for financial clarity across the Taxverse.",
}

export default function MottaAlliancePage() {
  return (
    <DashboardLayout>
      <MottaAlliance />
    </DashboardLayout>
  )
}
