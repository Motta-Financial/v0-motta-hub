import { Suspense } from "react"
import { SalesRecurringRevenue } from "@/components/sales-recurring-revenue"
import { DashboardLayout } from "@/components/dashboard-layout"

export const metadata = {
  title: "Recurring Revenue | ALFRED Hub",
  description:
    "Live monthly recurring revenue across Accounting and Tax, sourced from the Ignition feed.",
}

export default function RecurringRevenuePage() {
  return (
    <DashboardLayout>
      <Suspense fallback={null}>
        <SalesRecurringRevenue />
      </Suspense>
    </DashboardLayout>
  )
}
