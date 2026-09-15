import { DashboardLayout } from "@/components/dashboard-layout"
import { OutlookDashboard } from "@/components/settings/outlook-dashboard"

/**
 * Outlook settings — same shape as /settings/calendly. OutlookDashboard
 * handles all three connection states (not connected, connected, needs
 * reconnect) plus the read-only firm coverage list, so the page itself
 * is just a thin wrapper.
 */
export default function OutlookSettingsPage() {
  return (
    <DashboardLayout>
      <OutlookDashboard />
    </DashboardLayout>
  )
}
