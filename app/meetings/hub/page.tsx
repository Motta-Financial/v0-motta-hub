import { redirect } from "next/navigation"

/**
 * Legacy /meetings/hub — the unified "Hub Meetings" dashboard has been
 * superseded by Deals. A deal is the opportunity-level record that groups
 * a prospect's meetings (Zoom / phone / in person) plus the debrief, so
 * the per-meeting hub view now lives under /deals. This route permanently
 * forwards there so existing bookmarks and in-app links keep working.
 */
export default function LegacyHubMeetingsPage() {
  redirect("/meetings")
}
