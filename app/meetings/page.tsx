import DealsListView from "@/components/deals/deals-list-view"

/**
 * /meetings — the Deals pipeline is the default landing for the combined
 * Deals + Meetings section. A deal is the opportunity record (one per
 * prospect) that every meeting surface (Calendar / Calendly / Zoom) and
 * the post-meeting Debrief rolls up into, so the pipeline sits at the top
 * of the section and the meeting tabs hang off it via the sticky sub-nav
 * owned by `app/meetings/layout.tsx`.
 *
 * The DashboardLayout chrome + sub-nav come from the parent layout, so we
 * render the list view content directly (no extra wrapper).
 */
export default function MeetingsDealsPage() {
  return <DealsListView />
}
