import { Suspense } from "react"
import { DashboardLayout } from "@/components/dashboard-layout"
import { SalesDashboard } from "@/components/sales-dashboard"

export const metadata = {
  title: "Sales Dashboard | Motta Hub",
  description: "Pipeline, won deals, services, and geographic breakdown across Ignition proposals",
}

// `SalesDashboard` reads time-range filters from the URL via
// `useSearchParams`, which forces a client-rendering bailout. Next.js 15
// requires the boundary at the page level so the static prerender knows where
// to suspend; without it the production build fails on this route.
export default function SalesDashboardPage() {
  return (
    <DashboardLayout>
      <Suspense fallback={null}>
        <SalesDashboard />
      </Suspense>
    </DashboardLayout>
  )
}
