import { DashboardLayout } from "@/components/dashboard-layout"
import { IntakeList } from "@/components/intake/intake-list"

/**
 * /sales/intake — admin queue for the embedded Jotform intake form
 * on mottafinancial.com. Lists every submission, supports filter +
 * search, and opens a side sheet with the full Q/A breakdown plus
 * triage controls (status, owner, notes). Lives under Sales because
 * intake is the literal first stage of the sales funnel — every row
 * here is a prospect to qualify, propose to, or decline.
 */
export const metadata = {
  title: "Intake Submissions | Motta Hub",
  description: "Triage prospects who submitted the embedded intake form.",
}

export default function IntakePage() {
  return (
    <DashboardLayout>
      <IntakeList />
    </DashboardLayout>
  )
}
