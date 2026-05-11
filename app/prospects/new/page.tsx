import DashboardLayout from "@/components/dashboard-layout"
import { ProspectForm } from "@/components/prospects/prospect-form"

/**
 * /prospects/new — internal-only form for capturing prospects the
 * team meets out in the world. Wired into the global header
 * "Forms" dropdown (see components/dashboard-layout.tsx
 * → HEADER_FORMS).
 *
 * The form opens in a new tab from the dropdown so the teammate
 * doesn't lose whatever Hub page they had open. Once saved, they're
 * routed to /prospects/[id] for review + the Karbon work-item
 * action.
 */
export default function NewProspectPage() {
  return (
    <DashboardLayout>
      <ProspectForm />
    </DashboardLayout>
  )
}
