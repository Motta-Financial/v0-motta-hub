import { Suspense } from "react"
import { DashboardLayout } from "@/components/dashboard-layout"
import { FeedbackList } from "@/components/feedback/feedback-list"

/**
 * /sales/feedback — admin queue for the Jotform Feedback & Referral
 * form. Lives next to /sales/intake under the Sales section because
 * both are Jotform-driven client touchpoints that feed directly into
 * the revenue funnel — feedback drives referrals (new leads) and
 * detractor recovery (retention), both of which are sales motions.
 *
 * Supports ?search= URL param for deep-linking from Daily Briefing.
 */
export const metadata = {
  title: "Client Feedback | Motta Hub",
  description: "Triage client feedback submissions from the Jotform Feedback & Referral form.",
}

// FeedbackList uses useSearchParams for deep-linking, so we need Suspense
export default function FeedbackPage() {
  return (
    <DashboardLayout>
      <Suspense fallback={null}>
        <FeedbackList />
      </Suspense>
    </DashboardLayout>
  )
}
