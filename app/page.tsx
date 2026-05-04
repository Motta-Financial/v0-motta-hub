"use client"

import { DashboardLayout } from "@/components/dashboard-layout"
import { DashboardHome } from "@/components/dashboard-home"

// Home is now a single, focused dashboard surface. The previous version
// wrapped this in a Tabs widget with "Dashboard / Accounting / Tax /
// Special Teams" pills, but each of those targets is already its own
// page in the sidebar (`/accounting`, `/tax`, `/special-teams`). Keeping
// them as duplicate tabs on the home route was the source of the
// "I see Dashboard AND Home" confusion.
export default function Page() {
  return (
    <DashboardLayout>
      <DashboardHome />
    </DashboardLayout>
  )
}
