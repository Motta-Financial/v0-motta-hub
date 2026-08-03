import { redirect } from "next/navigation"

/**
 * /deals — legacy entry point for the opportunity pipeline. The pipeline
 * now lives inside the combined Deals + Meetings section at /meetings
 * (Deals is its default tab), so this route just redirects there. Deal
 * detail pages remain canonical at /deals/[id].
 */
export default function DealsPage() {
  redirect("/meetings")
}
