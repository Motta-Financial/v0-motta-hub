import { DashboardLayout } from "@/components/dashboard-layout"
import { FeedbackList } from "@/components/feedback/feedback-list"

/**
 * /sales/feedback — admin queue for the Jotform Feedback & Referral
 * form. Lives next to /sales/intake under the Sales section because
 * both are Jotform-driven client touchpoints that feed directly into
 * the revenue funnel — feedback drives referrals (new leads) and
 * detractor recovery (retention), both of which are sales motions.
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
