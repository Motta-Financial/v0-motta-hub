import { DashboardLayout } from "@/components/dashboard-layout"
import { ProspectDetail } from "@/components/prospects/prospect-detail"

/**
 * Prospect submission detail page.
 *
 * Reached two ways:
 *   - Immediately after a teammate submits the new-prospect form
 *     (`/prospects/new` redirects here with the freshly-created row's id).
 *   - From a future prospects-list page or a deep-link in a notification.
 *
 * The component does its own fetching via SWR off `/api/prospects/[id]`,
 * so this server-rendered shell stays tiny and we get the same loading
 * behavior on direct hits or refreshes.
 */
export default async function ProspectDetailPage({
  params,
}: {
  // Next.js 15 made `params` a Promise that must be awaited in the
  // server component — the intake detail page does the same dance,
  // so we mirror it for consistency.
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  return (
    <DashboardLayout>
      <ProspectDetail prospectId={id} />
    </DashboardLayout>
  )
}
