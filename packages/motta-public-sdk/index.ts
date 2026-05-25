/**
 * @motta/public-sdk — drop-in client for the motta.cpa marketing
 * site to talk to the ALFRED Hub public API.
 *
 * Architecture:
 *
 *   Browser (motta.cpa)
 *      │
 *      ├── direct Supabase reads (anon key)  →  marketing.* tables
 *      │     - blog posts, case studies (RLS: published only)
 *      │
 *      ├── direct Supabase RPC (anon key)    →  marketing.firm_stats_public_rpc()
 *      │     - hero strip stats
 *      │
 *      └── fetch() POST to motta.cpa/api/* (the marketing site's OWN
 *            Next.js API routes)
 *               │
 *               └── server-to-server fetch() to
 *                     https://hub.motta.cpa/api/public/* with
 *                     `x-motta-public-secret` header  →  Hub
 *
 * Why this split?
 *   - Reads that are safe under RLS go DIRECT from the browser to
 *     Supabase. Fast, cacheable, no Hub roundtrip.
 *   - Writes (contact, intake, newsletter) and anything that must
 *     bypass RLS proxy through the marketing project's API routes,
 *     which add the shared secret. The secret never reaches the
 *     browser.
 *
 * Usage in the marketing repo:
 *
 *   // lib/motta/index.ts (this file, copied in)
 *
 *   // app/api/contact/route.ts          (marketing project)
 *   import { hubFetch } from "@motta/public-sdk"
 *   export async function POST(req: Request) {
 *     const body = await req.json()
 *     const ip = req.headers.get("x-forwarded-for") ?? ""
 *     const ua = req.headers.get("user-agent") ?? ""
 *     return hubFetch("/api/public/contact", { body, ip, ua })
 *   }
 *
 *   // app/page.tsx                       (marketing project)
 *   import { getPublicSupabase } from "@motta/public-sdk"
 *   const supabase = getPublicSupabase()
 *   const { data: posts } = await supabase
 *     .schema("marketing")
 *     .from("blog_posts")
 *     .select("slug, title, excerpt, cover_image_url, published_at")
 *     .eq("status", "published")
 *     .order("published_at", { ascending: false })
 *     .limit(6)
 */

export { hubFetch, type HubFetchOptions, type HubFetchResult } from "./client"
export {
  getPublicSupabase,
  type FirmStatsPublic,
  type BlogPost,
  type CaseStudy,
} from "./direct"
export type {
  ContactSubmissionInput,
  IntakeSubmissionInput,
  NewsletterSignupInput,
} from "./types"
