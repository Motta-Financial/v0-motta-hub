import { DashboardLayout } from "@/components/dashboard-layout"
import DebriefsView from "@/components/debriefs-view"

/**
 * Legacy /debriefs route — preserved so existing bookmarks, deep-links
 * from emails, and links inside Karbon notes keep working. The
 * canonical location is now /clients/meetings/debriefs.
 *
 * Both routes render the exact same DebriefsView component; only the
 * surrounding chrome differs (this route is bare DashboardLayout, the
 * /clients/meetings/* version adds the meetings sub-nav). Keep this in
 * sync — if DebriefsView grows new functionality, both routes inherit
 * it automatically.
 */
export default function DebriefsLegacyPage() {
  return (
    <DashboardLayout>
      <DebriefsView />
    </DashboardLayout>
  )
}
