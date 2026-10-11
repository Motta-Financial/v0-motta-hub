import { DashboardLayout } from "@/components/dashboard-layout"
import { ProspectList } from "@/components/prospects/prospect-list"

/**
 * /prospects — every prospect a teammate has captured with the Prospect
 * Form, newest first. Each row opens /prospects/[id] (triage, Karbon work
 * item, ProConnect return).
 */
export const metadata = {
  title: "Prospects | ALFRED Hub",
  description: "Prospects captured by the team, with status and owner.",
}

export default function ProspectsPage() {
  return (
    <DashboardLayout>
      <ProspectList />
    </DashboardLayout>
  )
}
