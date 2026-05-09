import { DashboardLayout } from "@/components/dashboard-layout"
import { IntakeList } from "@/components/intake/intake-list"

/**
 * /intake — admin queue for the embedded Jotform intake form on
 * mottafinancial.com. Lists every submission, supports filter +
 * search, and opens a side sheet with the full Q/A breakdown plus
 * triage controls (status, owner, notes).
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
