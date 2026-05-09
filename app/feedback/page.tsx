import { DashboardLayout } from "@/components/dashboard-layout"
import { FeedbackList } from "@/components/feedback/feedback-list"

/**
 * /feedback — admin queue for the Jotform Feedback & Referral form.
 * Lives next to /intake conceptually (both are Jotform-driven client
 * touchpoints), but is filed under Home → Debriefs in the sidebar
 * because it's a client-feedback channel rather than a sales-pipeline
 * stage.
 *
 * No server data fetched here — FeedbackList drives everything via
 * SWR against `/api/jotform/feedback*` so triage edits revalidate the
 * list in place without a route refresh.
 */
export const metadata = {
  title: "Client Feedback | Motta Hub",
  description: "Triage client feedback submissions from the Jotform Feedback & Referral form.",
}

export default function FeedbackPage() {
  return (
    <DashboardLayout>
      <FeedbackList />
    </DashboardLayout>
  )
}
