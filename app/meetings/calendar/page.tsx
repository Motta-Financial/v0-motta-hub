import { Suspense } from "react"
import { TeamCalendarPageClient } from "@/components/team-calendar/team-calendar-page-client"

/**
 * /meetings/calendar — the firm-wide Team Calendar. Previously a
 * top-level route at /calendar (which now redirects here). Rendered in
 * `embedded` mode so the DashboardLayout chrome + sticky meetings
 * sub-nav come from app/meetings/layout.tsx instead of the component
 * double-wrapping its own layout.
 */
function CalendarFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="text-center">
        <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-primary" />
        <p className="text-muted-foreground">Loading calendar…</p>
      </div>
    </div>
  )
}

export default function MeetingsCalendarPage() {
  return (
    <Suspense fallback={<CalendarFallback />}>
      <TeamCalendarPageClient embedded />
    </Suspense>
  )
}
