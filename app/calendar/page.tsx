import { redirect } from "next/navigation"

/**
 * Legacy /calendar — the Team Calendar moved under the new top-level
 * Meetings section at /meetings/calendar. This route permanently
 * forwards there so existing bookmarks and in-app links keep working.
 */
export default function LegacyCalendarPage() {
  redirect("/meetings/calendar")
}
