import { redirect } from "next/navigation"

/**
 * The standalone /triage page has been folded into the Home dashboard's
 * Triage feed (see components/triage-feed.tsx). We keep this route file
 * around as a permanent redirect so any deep-links, bookmarks, or stale
 * email links land in the right place — it's cheaper than 404'ing them.
 */
export default function TriagePage() {
  redirect("/")
}
