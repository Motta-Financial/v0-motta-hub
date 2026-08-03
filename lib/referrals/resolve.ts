/**
 * Motta Hub referral resolution state machine.
 *
 * Spec: v0_memories/user/motta-hub-data-model.md §4.
 *
 * Pure functions: classify a raw "referred by" string and look up the
 * referrer in a contacts cache keyed by legacy_motta_client_id.
 */

import { LEGACY_ID_PATTERN } from "@/lib/legacy-client-id"

export type ReferralMatchStatus =
  | "matched"
  | "unmatched_not_in_hub"
  | "unmatched_format"
  | "external_referrer"
  | "no_referral"

const EXTERNAL_KEYWORDS = [
  "google",
  "linkedin",
  "facebook",
  "instagram",
  "twitter",
  " x ",
  "tiktok",
  "yelp",
  "bbb",
  "better business bureau",
  "bing",
  "search engine",
  "website",
  "online",
  "seo",
  "advertis",
  "ad ",
  " ads",
  "referral partner",
  "partner firm",
  "npr",
  "radio",
  "podcast",
  "youtube",
  "newsletter",
]

/**
 * Detect external (non-client) referrers. Conservative — when in
 * doubt, fall through to `unmatched_format` so a human can review.
 */
function looksExternal(raw: string): boolean {
  const lower = ` ${raw.toLowerCase()} `
  return EXTERNAL_KEYWORDS.some((kw) => lower.includes(kw))
}

export interface ReferrerHit {
  contact_id: string
  karbon_contact_key: string | null
  full_name: string | null
}

/**
 * Pure resolver. Takes the raw value, normalizes, classifies, and —
 * for matched-pattern values — looks up the referrer in `lookup`.
 */
export function resolveReferral(args: {
  raw: string | null | undefined
  /** legacy_id (uppercased) → referrer record */
  lookup: Map<string, ReferrerHit>
}): {
  match_status: ReferralMatchStatus
  referred_by_raw: string | null
  referred_by_legacy_id: string | null
  referrer: ReferrerHit | null
} {
  const raw = (args.raw ?? "").trim()

  if (!raw) {
    return {
      match_status: "no_referral",
      referred_by_raw: null,
      referred_by_legacy_id: null,
      referrer: null,
    }
  }

  const normalized = raw.toUpperCase()

  // Tight pattern check — only structurally-valid legacy IDs are
  // candidates for the contacts.legacy_motta_client_id lookup.
  if (LEGACY_ID_PATTERN.test(normalized)) {
    const hit = args.lookup.get(normalized) ?? null
    return {
      match_status: hit ? "matched" : "unmatched_not_in_hub",
      referred_by_raw: raw,
      referred_by_legacy_id: normalized,
      referrer: hit,
    }
  }

  // Free-text — classify external vs. unmatched_format.
  if (looksExternal(raw)) {
    return {
      match_status: "external_referrer",
      referred_by_raw: raw,
      referred_by_legacy_id: null,
      referrer: null,
    }
  }

  return {
    match_status: "unmatched_format",
    referred_by_raw: raw,
    referred_by_legacy_id: null,
    referrer: null,
  }
}
