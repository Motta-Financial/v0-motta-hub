import { CalendlyDashboard } from "@/components/calendly-dashboard"

/**
 * /clients/meetings/calendly — Calendly bookings + master calendar.
 *
 * The CalendlyDashboard component handles the three OAuth states
 * (not connected, needs reauth, healthy) so this page is just a thin
 * wrapper. The DashboardLayout chrome + sticky meetings sub-nav are
 * provided by the parent layout.tsx.
 *
 * NOTE: there is also a per-user Calendly connection screen at
 * /settings/calendly. That page is for OAuth setup; THIS page is the
 * data view operators use day-to-day. Both render the same component
 * because the component itself adapts to the user&apos;s connection
 * state — kept this way to avoid duplicating the OAuth-state UI.
 */
export default function ClientMeetingsCalendlyPage() {
  return <CalendlyDashboard />
}
