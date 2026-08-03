import { redirect } from "next/navigation"

/**
 * /sales/intake/dashboard — legacy URL kept alive only as a permanent
 * redirect. The dashboard is now a tab inside /sales/intake itself
 * (see app/sales/intake/page.tsx). Anyone with a stale bookmark or
 * the old "View dashboard" button on the queue gets sent to the same
 * view via the `?view=dashboard` query param.
 */
export default function IntakeDashboardLegacyRedirect() {
  redirect("/sales/intake?view=dashboard")
}
