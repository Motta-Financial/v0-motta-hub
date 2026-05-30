import DealsListView from "@/components/deals/deals-list-view"
import { DashboardLayout } from "@/components/dashboard-layout"

/**
 * /deals — the opportunity pipeline. One deal per prospect. Replaces the
 * old "Hub Meetings" framing: meetings now roll UP into a deal, and the
 * debrief is performed on the deal rather than a Karbon work item.
 */
export default function DealsPage() {
  return (
    <DashboardLayout>
      <DealsListView />
    </DashboardLayout>
  )
}
