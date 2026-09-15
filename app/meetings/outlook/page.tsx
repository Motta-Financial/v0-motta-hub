import { OutlookDashboard } from "@/components/settings/outlook-dashboard"

/**
 * /meetings/outlook — same OutlookDashboard used at /settings/outlook.
 * The DashboardLayout chrome + sticky meetings sub-nav are provided by
 * the parent layout.tsx, so this page is just a thin wrapper (same
 * pattern as /meetings/calendly reusing CalendlyDashboard).
 */
export default function MeetingsOutlookPage() {
  return <OutlookDashboard />
}
