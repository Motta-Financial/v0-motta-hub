import { redirect } from "next/navigation"

/**
 * /feedback — legacy URL kept alive only as a permanent redirect.
 *
 * The page itself now lives at /sales/feedback (filed under Sales
 * because client feedback drives referrals and detractor recovery —
 * both sales motions). This stub keeps any old bookmarks or links
 * working with a clean 308 redirect.
 */
export default function FeedbackLegacyRedirect() {
  redirect("/sales/feedback")
}
