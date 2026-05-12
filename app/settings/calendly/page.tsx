import { DashboardLayout } from "@/components/dashboard-layout"
import { CalendlyDashboard } from "@/components/calendly-dashboard"

/**
 * Calendly settings — moved from /calendly. The CalendlyDashboard
 * component handles the three states a user can be in (not connected,
 * needs reauth, healthy) and renders the required OAuth setup flow,
 * so the page itself is just a thin wrapper.
 *
 * The old /calendly route still works and redirects here, so any
 * existing bookmarks or OAuth post-auth landings keep functioning.
 */
export default function CalendlySettingsPage() {
  return (
    <DashboardLayout>
      <CalendlyDashboard />
    </DashboardLayout>
  )
}
