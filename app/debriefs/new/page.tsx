import { Suspense } from "react"
import { DebriefForm } from "@/components/debrief-form"
import DashboardLayout from "@/components/dashboard-layout"

export default function NewDebriefPage() {
  return (
    <DashboardLayout>
      {/* DebriefForm reads prefill values via useSearchParams (when launched
          from a meeting), which requires a Suspense boundary. */}
      <Suspense fallback={null}>
        <DebriefForm />
      </Suspense>
    </DashboardLayout>
  )
}
