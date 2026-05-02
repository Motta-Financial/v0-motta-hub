import { Suspense } from "react"
import { DashboardLayout } from "@/components/dashboard-layout"
import { SalesProposals } from "@/components/sales-proposals"

export const metadata = {
  title: "Proposals | Motta Hub",
  description: "Browse, filter, and search every Ignition proposal",
}

// `SalesProposals` reads filter state from the URL with `useSearchParams`, so
// it can't be statically prerendered. The Suspense boundary lets Next.js bail
// out to client rendering for this page during the production build.
export default function SalesProposalsPage() {
  return (
    <DashboardLayout>
      <Suspense fallback={null}>
        <SalesProposals />
      </Suspense>
    </DashboardLayout>
  )
}
