import DebriefsView from "@/components/debriefs-view"

/**
 * /clients/meetings/debriefs — Post-meeting debriefs view. Shares the
 * DebriefsView component with the legacy /debriefs route; this URL is
 * the canonical home, the legacy one stays alive as a redirect-free
 * alias so existing bookmarks keep working.
 *
 * DashboardLayout chrome + sticky meetings sub-nav are provided by the
 * parent app/clients/meetings/layout.tsx.
 */
export default function ClientMeetingsDebriefsPage() {
  return <DebriefsView />
}
