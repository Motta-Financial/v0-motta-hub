import { redirect } from "next/navigation"

/**
 * Karbon webhook management has moved to /admin/karbon-sync.
 * That page is wired to the canonical webhook receiver at
 * /api/karbon/webhooks (with HMAC verification, idempotency, and a watchdog).
 *
 * This redirect preserves any existing bookmarks/links to /settings/webhooks.
 */
export default function WebhooksPageRedirect() {
  redirect("/admin/karbon-sync")
}
