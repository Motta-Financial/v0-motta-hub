import { DashboardLayout } from "@/components/dashboard-layout"
import { WorkItemsView } from "@/components/work-items-view"

// Server component — reads the `?q=` query param so the global Cmd+K palette
// can deep-link straight into a filtered view of the work-items list.
export default async function WorkItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const params = await searchParams
  const initialSearch = typeof params.q === "string" ? params.q : undefined

  return (
    <DashboardLayout>
      <WorkItemsView initialSearch={initialSearch} />
    </DashboardLayout>
  )
}
