/**
 * Ignition → Recurring Revenue classifier
 * ────────────────────────────────────────────────────────────────────────
 * Ignition service names follow a handful of conventions ("Tax | Prep
 * (1040): …", "Accounting | Bookkeeping Services (Monthly)", legacy bare
 * "Bookkeeping Services (Monthly)", etc). This module collapses them into
 * a small set of stable buckets so the Recurring Revenue page can group
 * cleanly without the partner team having to rename anything in Ignition.
 *
 * Three derived facts per service:
 *   • department    — "Accounting" | "Tax"
 *   • service_type  — the clean bucket shown in the UI (e.g. "Bookkeeping",
 *                     "Individual Tax (1040)", "Onboarding & Optimization")
 *   • is_onboarding — true when the line item is a setup / clean-up /
 *                     onboarding / optimization charge. These are reported
 *                     in a dedicated column rather than rolled into the
 *                     generic "one-time" bucket so partners can see the
 *                     Onboarding & Optimization fees explicitly.
 *
 * Keep this file pure (no DB, no React) so the API route and any future
 * tests can import it cheaply.
 */

export type Department = "Accounting" | "Tax"

export interface ServiceClassification {
  department: Department
  service_type: string
  is_onboarding: boolean
}

/** Lowercased once, used by every matcher below. */
function lower(s: string | null | undefined): string {
  return (s ?? "").toLowerCase()
}

/**
 * The "Tax" pattern matchers run FIRST because some Tax services contain
 * the word "Accounting" in their Ignition description, but no Accounting
 * service references "Schedule", "1040", "1120", "1065", or "estimate".
 *
 * Order within each section matters: more-specific patterns come before
 * less-specific ones (e.g. "Schedule C" before "Schedule").
 */
const TAX_PATTERNS: Array<{
  match: (n: string) => boolean
  bucket: string
}> = [
  // Form-specific patterns (the explicit ones, easy to read off the service name)
  { match: (n) => /\b(1040|individual tax return)\b/.test(n), bucket: "Individual Tax (1040)" },
  { match: (n) => /\b1120s\b|s[- ]?corp/.test(n),              bucket: "S-Corp Tax (1120S)" },
  { match: (n) => /\b1120(?!s)\b|c[- ]?corp/.test(n),          bucket: "C-Corp Tax (1120)" },
  { match: (n) => /\b1065\b|partnership/.test(n),              bucket: "Partnership Tax (1065)" },
  { match: (n) => /\b990\b|nonprofit|non[- ]?profit/.test(n),  bucket: "Non-Profit Tax (990)" },
  { match: (n) => /\bestate\b|\b706\b|\b1041\b|trust/.test(n), bucket: "Estate & Trust Tax" },

  // Schedule add-ons — preserved as a single service line because partners
  // think of them collectively when pricing returns.
  { match: (n) => /schedule [a-k]\b|schedule k-?1/.test(n),    bucket: "Schedule add-on" },

  // State / city / other jurisdictions
  { match: (n) => /\bstate return\b|prep \(state\)|state.*return/.test(n), bucket: "State Returns" },

  // Estimates & planning
  { match: (n) => /\bestimate\b|\bquarterly\b.*tax/.test(n),   bucket: "Tax Estimates" },
  { match: (n) => /\badvisory\b|\bplanning\b/.test(n),         bucket: "Tax Advisory" },

  // Generic tax catch-alls — only fire if "tax" is mentioned somewhere.
  { match: (n) => /\bprep\b/.test(n),                          bucket: "Tax Preparation" },
  { match: (n) => /\btax\b/.test(n),                           bucket: "Tax Services" },
]

const ACCOUNTING_PATTERNS: Array<{
  match: (n: string) => boolean
  bucket: string
}> = [
  // CFO sits above Controller because some CFO engagements include
  // controller-style review work in the description.
  { match: (n) => /\bcfo\b/.test(n),                           bucket: "CFO Services" },
  { match: (n) => /\bcontroller\b/.test(n),                    bucket: "Controller" },
  { match: (n) => /\bfp&?a\b|financial planning.*analysis/.test(n), bucket: "FP&A" },
  { match: (n) => /cash[- ]?flow|\badvisory\b/.test(n),        bucket: "Cash Flow Advisory" },
  { match: (n) => /\bpayroll\b/.test(n),                       bucket: "Payroll" },
  { match: (n) => /bookkeep/.test(n),                          bucket: "Bookkeeping" },
  // Software (QBO / Xero) passthrough charges. These are often billed
  // monthly so they roll into MRR — partners count them as recurring.
  { match: (n) => /quickbooks|qbo|xero|software/.test(n),      bucket: "Software" },
  { match: (n) => /mottaguard|compliance/.test(n),             bucket: "Compliance" },
  { match: (n) => /acct fees?|account(?:ing)? fees?/.test(n),  bucket: "Acct Fees" },
  // Catch-all for explicitly Accounting-prefixed services
  { match: (n) => /\baccounting\b/.test(n),                    bucket: "Accounting" },
]

/**
 * Returns true when a service line is part of the firm's
 * "Onboarding & Optimization" bundle — the one-time fee that accompanies a
 * new recurring engagement. We name these out separately because partners
 * specifically want to see Onboarding revenue distinct from miscellaneous
 * one-time work.
 */
function detectOnboarding(name: string): boolean {
  const n = lower(name)
  return (
    /onboarding/.test(n) ||
    /set[- ]?up/.test(n) ||
    /clean[- ]?up/.test(n) ||
    /optimization/.test(n) ||
    /\breview\b.*\b(bookkeeping|books)\b/.test(n) ||
    /catch[- ]?up/.test(n) ||
    /implementation/.test(n)
  )
}

/**
 * Classify a single Ignition service into department + service_type +
 * onboarding flag. Defaults to Accounting when truly ambiguous — most of
 * the unclassifiable lines we audited were accounting add-ons.
 */
export function classifyService(serviceName: string | null | undefined): ServiceClassification {
  const raw = (serviceName ?? "").trim()
  const n = lower(raw)

  // Explicit Ignition prefix conventions are the most reliable signal.
  // "Tax | …" or "TAX | …" or "Tax Prep" → Tax
  const hasTaxPrefix = /^(tax\s*\||tax\s+|tax:)/i.test(raw) || /^tax\b/.test(n)
  // "Accounting | …" or "ACCT | …" → Accounting
  const hasAcctPrefix = /^(accounting\s*\||acct\s*\||acct\s+|accounting\s+)/i.test(raw)

  // Tax matchers
  if (hasTaxPrefix || !hasAcctPrefix) {
    for (const p of TAX_PATTERNS) {
      if (p.match(n)) {
        return {
          department: "Tax",
          // Onboarding-y tax lines (rare but exist: "Document Organization &
          // Analysis") roll into a per-department onboarding bucket.
          service_type: detectOnboarding(raw) ? "Onboarding & Optimization" : p.bucket,
          is_onboarding: detectOnboarding(raw),
        }
      }
    }
  }

  // Accounting matchers
  for (const p of ACCOUNTING_PATTERNS) {
    if (p.match(n)) {
      return {
        department: "Accounting",
        service_type: detectOnboarding(raw) ? "Onboarding & Optimization" : p.bucket,
        is_onboarding: detectOnboarding(raw),
      }
    }
  }

  // Last resort: unbucketable. Default to Accounting because that's where
  // the majority of unclassified services historically land in this firm.
  return {
    department: hasTaxPrefix ? "Tax" : "Accounting",
    service_type: detectOnboarding(raw) ? "Onboarding & Optimization" : "Other",
    is_onboarding: detectOnboarding(raw),
  }
}

/**
 * Normalized client identifier used to group services by client across
 * proposals. Mirrors the SQL generated column on `motta_recurring_revenue`
 * so it stays consistent with the curated list for any cross-checking.
 */
export function normalizeClientName(name: string | null | undefined): string {
  if (!name) return ""
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "")
}

/**
 * Statuses that count as "currently earning recurring revenue".
 *   • accepted — proposal signed, services live (or about to be)
 *   • completed — engagement complete from Ignition's perspective but
 *                 service lines may still describe monthly fees that
 *                 represent ongoing work (Ignition marks a proposal
 *                 "completed" when the *proposal* is fully accepted, not
 *                 when the recurring engagement ends).
 *
 * We additionally guard on revoked_at / lost_at / archived_at being null
 * because Ignition sometimes leaves status="accepted" on revoked deals.
 */
export const ACTIVE_PROPOSAL_STATUSES = ["accepted", "completed"] as const

export type IgnitionBillingFrequency =
  | "monthly"
  | "quarterly"
  | "one-time"
  | "weekly"
  | "annually"
  | "other"

/** Coerce free-form Ignition billing_frequency strings to our enum. */
export function normalizeBillingFrequency(
  freq: string | null | undefined,
): IgnitionBillingFrequency {
  const f = (freq ?? "").toLowerCase()
  if (!f) return "one-time"
  if (f.includes("month")) return "monthly"
  if (f.includes("quarter")) return "quarterly"
  if (f.includes("week")) return "weekly"
  if (f.includes("year") || f.includes("annual")) return "annually"
  if (f.includes("one") || f === "one-time" || f === "onetime") return "one-time"
  return "other"
}

/**
 * Policy-aware billing frequency.
 *
 * Ignition's `billing_frequency` field is frequently miscoded for Tax
 * services — partners enter "Monthly" when collecting in installments
 * for a return that is still fundamentally a one-time engagement
 * (e.g. "Tax Preparation: S-Corp (1120s)" marked Monthly @ $2,550,
 * "Tax | Quarterly Tax Estimates" marked Monthly @ $1,800, "Schedule C"
 * marked Monthly, etc.). Those line items roll into recurring revenue
 * at the data layer if we trust the raw field, which inflates MRR and
 * misrepresents the firm's true recurring book.
 *
 * Firm policy: TAX IS NEVER RECURRING. Quarterly estimates, returns of
 * any form (1040 / 1120 / 1120S / 1065 / 990 / 706 / 1041), Schedule
 * add-ons, amendments, planning, and advisory all bill as one-time
 * regardless of how Ignition records the cadence. Only Accounting
 * services (Bookkeeping, Payroll, CFO, Controller, FP&A, etc.) can be
 * monthly or quarterly recurring.
 *
 * This function is the single source of truth for that policy — every
 * downstream aggregation (MRR, ARR, cadences, recurring rows) must use
 * the effective frequency rather than the raw one.
 */
export function effectiveBillingFrequency(
  rawFreq: string | null | undefined,
  department: Department,
): IgnitionBillingFrequency {
  if (department === "Tax") return "one-time"
  return normalizeBillingFrequency(rawFreq)
}

/**
 * Monthly recurring contribution of a single service line:
 *   monthly        → full amount
 *   quarterly      → amount ÷ 3
 *   weekly         → amount × 4.333  (avg weeks/month)
 *   annually       → amount ÷ 12
 *   one-time/other → 0  (no recurring contribution)
 */
export function monthlyContribution(amount: number, freq: IgnitionBillingFrequency): number {
  switch (freq) {
    case "monthly":   return amount
    case "quarterly": return amount / 3
    case "weekly":    return amount * (52 / 12)
    case "annually":  return amount / 12
    default:          return 0
  }
}

/**
 * Annualized contribution. Mirrors `monthlyContribution` but multiplied
 * for full-year roll-ups. Kept separate (rather than `monthly × 12`) to
 * avoid floating-point drift on quarterly and weekly cadences.
 */
export function annualContribution(amount: number, freq: IgnitionBillingFrequency): number {
  switch (freq) {
    case "monthly":   return amount * 12
    case "quarterly": return amount * 4
    case "weekly":    return amount * 52
    case "annually":  return amount
    default:          return 0
  }
}
