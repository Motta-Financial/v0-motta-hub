import DealDetailView from "@/components/deals/deal-detail-view"
import { DashboardLayout } from "@/components/dashboard-layout"

/**
 * /deals/[id] — single deal. Shows the meetings timeline (Zoom / phone /
 * in person), tagged Karbon work items, and the debriefs performed on the
 * deal. The "Run debrief" action launches the shared DebriefForm prefilled
 * with the deal's contact + deal_id.
 */
export default async function DealDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <DashboardLayout>
      <DealDetailView dealId={id} />
    </DashboardLayout>
  )
}
