import { redirect } from "next/navigation"

/**
 * Webhook integrations have moved to /admin/webhooks — a single
 * console that aggregates Karbon, Jotform, Calendly, Zoom, and
 * Ignition. This redirect preserves any legacy bookmarks.
 */
export default function WebhooksPageRedirect() {
  redirect("/admin/webhooks")
}
