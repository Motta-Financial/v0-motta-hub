import { Suspense } from "react"
import { CalendarPageClient } from "@/components/calendar-page-client"

function CalendarFallback() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
        <p className="text-muted-foreground">Loading calendar...</p>
      </div>
    </div>
  )
}

export default function CalendarPage() {
  return (
    <Suspense fallback={<CalendarFallback />}>
      <CalendarPageClient />
    </Suspense>
  )
}
