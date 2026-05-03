import { DashboardLayout } from "@/components/dashboard-layout"
// Use the real-data tracker (driven by /api/supabase/work-items) instead of
// the legacy BookkeepingTracker, which seeded its UI with hardcoded clients.
import { AccountingBookkeepingTracker } from "@/components/accounting-bookkeeping-tracker"

export default function BookkeepingPage() {
  return (
    <DashboardLayout>
      <AccountingBookkeepingTracker />
    </DashboardLayout>
  )
}
