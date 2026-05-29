import { redirect } from "next/navigation"

/**
 * Legacy /clients/meetings — Meetings moved out from under Clients to a
 * top-level Home section at /meetings. This route now permanently
 * forwards there so existing bookmarks and deep links keep working.
 */
export default function LegacyClientMeetingsPage() {
  redirect("/meetings")
}
