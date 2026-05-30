import HubMeetingsView from "@/components/meetings/hub-meetings-view"

/**
 * /meetings/hub — the unified Hub Meetings dashboard. Each row is one
 * Hub Meeting ID that ties together its Prospect/Intake, Calendly
 * booking, Zoom recording + transcript, ALFRED summary, and Debrief.
 *
 * DashboardLayout chrome + the sticky meetings sub-nav are provided by
 * the parent app/meetings/layout.tsx.
 */
export default function HubMeetingsPage() {
  return <HubMeetingsView />
}
