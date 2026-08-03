import { Suspense } from "react"
import { DashboardLayout } from "@/components/dashboard-layout"
import { IntakeTabs } from "@/components/intake/intake-tabs"

/**
 * /sales/intake — the single Intake surface. Replaces the previous
 * pair of routes (/sales/intake for the operational queue and
 * /sales/intake/dashboard for analytics) with one page that exposes
 * both views as tabs. The legacy dashboard route still exists as a
 * redirect to /sales/intake?view=dashboard so old deep-links keep
 * working.
 *
 * The Jotform integration status card was moved off this page onto
 * /admin/webhooks, since webhook health belongs in admin tooling
 * rather than the sales workflow.
 *
 * Supports ?search= URL param for deep-linking from Daily Briefing.
 */
export const metadata = {
  title: "Intake | Motta Hub",
  description:
    "Triage prospects from the embedded intake form and view pipeline analytics.",
}

export default function IntakePage() {
  return (
    <DashboardLayout>
      <Suspense fallback={null}>
        <IntakeTabs />
      </Suspense>
    </DashboardLayout>
  )
}
