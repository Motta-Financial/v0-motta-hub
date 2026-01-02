import { DashboardLayout } from "@/components/dashboard-layout"
import { TommyAwardsPage } from "@/components/tommy-awards/tommy-awards-page"

export const metadata = {
  title: "Tommy Awards | Motta Financial",
  description: "Weekly peer recognition program celebrating championship characteristics",
}

export default function Page() {
  return (
    <DashboardLayout>
      <TommyAwardsPage />
    </DashboardLayout>
  )
}
