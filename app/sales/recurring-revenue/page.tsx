import { Suspense } from "react"
import { SalesRecurringRevenue } from "@/components/sales-recurring-revenue"
import { DashboardLayout } from "@/components/dashboard-layout"

export const metadata = {
  title: "Recurring Revenue · Motta Hub",
  description:
    "Curated monthly recurring revenue across Accounting and Tax, sourced from the partner-maintained CSV.",
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
