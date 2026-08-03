import { DashboardLayout } from "@/components/dashboard-layout"
import { TaxOverviewClient } from "@/components/tax/tax-overview-client"

// ── /tax — Tax Department Overview ──────────────────────────────────
// This is the parent dashboard for the four sub-pages
// (clients/individual/business/nonprofit). It mirrors the live
// proconnect_engagements + proconnect_clients tables, so any change to
// ProConnect surfaces here on the next sync (cron at 06:00 UTC).
//
// Previously this page rendered the Karbon-task ServiceLineDashboard,
// which double-counted work-items as "tax returns". Per the 5/22
// directive, the parent surface now reads from ProConnect directly so
// it agrees with the four child surfaces below it.
export default function TaxPage() {
  return (
    <DashboardLayout>
      <TaxOverviewClient />
    </DashboardLayout>
  )
}
