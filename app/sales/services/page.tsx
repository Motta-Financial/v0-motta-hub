import { Suspense } from "react"
import { DashboardLayout } from "@/components/dashboard-layout"
import { SalesServices } from "@/components/sales-services"

export const metadata = {
  title: "Services | Motta Hub",
  description: "Ignition service catalog with usage and revenue metrics",
}

// `SalesServices` reads URL filters via `useSearchParams`, which opts the page
// out of static prerendering. Wrapping in Suspense satisfies Next.js 15's
// build-time CSR-bailout requirement.
export default function SalesServicesPage() {
  return (
    <DashboardLayout>
      <Suspense fallback={null}>
        <SalesServices />
      </Suspense>
    </DashboardLayout>
  )
}
