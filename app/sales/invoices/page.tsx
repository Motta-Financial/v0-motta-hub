import { Suspense } from "react"
import { DashboardLayout } from "@/components/dashboard-layout"
import { SalesInvoices } from "@/components/sales-invoices"

export const metadata = {
  title: "Invoices | Motta Hub",
  description: "Billed amounts, payments collected, and outstanding balances",
}

// `SalesInvoices` reads URL filters via `useSearchParams`, which forces this
// page off the static prerender path. Without a Suspense boundary Next.js 15
// fails the production build (see "missing-suspense-with-csr-bailout"). The
// fallback is intentionally minimal — the inner component already renders its
// own skeleton once it mounts, so we just need the boundary.
export default function SalesInvoicesPage() {
  return (
    <DashboardLayout>
      <Suspense fallback={null}>
        <SalesInvoices />
      </Suspense>
    </DashboardLayout>
  )
}
