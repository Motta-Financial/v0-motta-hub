import { Suspense } from "react"
import { DashboardLayout } from "@/components/dashboard-layout"
import { SalesPayments } from "@/components/sales-payments"

export const metadata = {
  title: "Payments | Motta Hub",
  description: "Live Ignition payment activity — gross, fees, net, and refunds",
}

// `SalesPayments` reads URL filters via `useSearchParams`, which forces
// this page off Next.js's static prerender path. Wrapping it in Suspense
// satisfies the App Router's missing-suspense-with-csr-bailout rule. The
// fallback is intentionally minimal because the component already
// renders its own skeleton state once it mounts.
export default function PaymentsPage() {
  return (
    <DashboardLayout>
      <Suspense fallback={null}>
        <SalesPayments />
      </Suspense>
    </DashboardLayout>
  )
}
