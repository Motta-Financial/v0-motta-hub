import { redirect } from "next/navigation"

/**
 * /calendly was the original home of the per-user Calendly dashboard.
 * It's been moved under /settings/calendly so it sits alongside the
 * other user-personal settings (Profile, Notifications, Users, etc.).
 *
 * We keep this route as a server-side redirect rather than deleting
 * it so that:
 *   - Existing bookmarks keep working.
 *   - Calendly's OAuth "back to app" landings — and the sidebar in
 *     previously-loaded client bundles — don't 404.
 */
export default function CalendlyRedirectPage() {
  redirect("/settings/calendly")
}
