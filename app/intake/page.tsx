import { redirect } from "next/navigation"

/**
 * /intake — legacy URL kept alive only as a permanent redirect.
 *
 * The page itself now lives at /sales/intake (filed under the Sales
 * section in the sidebar, alongside /sales/feedback, /sales/proposals,
 * etc.). Anyone with a bookmarked link, an external email reference,
 * or a stale browser tab on /intake gets a clean 308 redirect instead
 * of a 404. Safe to delete this stub once we're confident no consumers
 * still point at the old path.
 */
export default function IntakeLegacyRedirect() {
  redirect("/sales/intake")
}
