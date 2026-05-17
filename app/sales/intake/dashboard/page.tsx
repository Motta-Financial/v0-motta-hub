import { DashboardLayout } from "@/components/dashboard-layout"
import { IntakeDashboard } from "@/components/intake/intake-dashboard"

/**
 * /sales/intake/dashboard — analytics view of the Jotform intake
 * pipeline. The companion to /sales/intake (operational queue).
 * Pulls server-aggregated metrics from
 * GET /api/jotform/intake/dashboard.
 */
export const metadata = {
  title: "Intake Dashboard | Motta Hub",
  description: "Trends, funnel, and segment breakdown for Motta intake submissions.",
}

export default function IntakeDashboardPage() {
  return (
    <DashboardLayout>
      <IntakeDashboard />
    </DashboardLayout>
  )
}
