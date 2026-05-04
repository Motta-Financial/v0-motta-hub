import { redirect } from "next/navigation"

// Client Services was consolidated into the Sales section — Payments,
// Invoices, Proposals, Recurring Revenue, and Ignition all live under
// /sales now. Anyone hitting the old /client-services URL (deep links,
// browser history, stale bookmarks) gets bounced to /sales instead of
// landing on a redundant dashboard page.
export default function ClientServicesPage() {
  redirect("/sales")
}
