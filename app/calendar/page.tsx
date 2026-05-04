import { Suspense } from "react"
import { TeamCalendarPageClient } from "@/components/team-calendar/team-calendar-page-client"

function CalendarFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-primary" />
        <p className="text-muted-foreground">Loading calendar…</p>
      </div>
    </div>
  )
}

export default function CalendarPage() {
  return (
    <Suspense fallback={<CalendarFallback />}>
      <TeamCalendarPageClient />
    </Suspense>
  )
}
