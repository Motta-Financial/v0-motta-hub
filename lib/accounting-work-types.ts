// Single source of truth for the canonical Accounting Karbon
// work_types. Mirrors the Karbon Work Types admin screen:
//
//   ACCT | 1099s
//   ACCT | Bookkeeping
//   ACCT | FP&A
//   ACCT | Onboarding (BKPG)
//   ACCT | Onboarding (PYRL)
//   ACCT | Payroll
//   Outsourced (NFP) | Bookkeeping
//   Outsourced (NFP) | Onboarding
//
// The two `Outsourced (NFP) | …` types come from the not-for-profit
// outsourced engagement track but are functionally Accounting services,
// so they roll up into the same dashboards/trackers as their `ACCT |`
// counterparts (NFP Bookkeeping → Bookkeeping tracker; NFP Onboarding →
// Onboarding tracker).
//
// Every Accounting surface in the app (the /accounting overview cards,
// the Bookkeeping & Onboarding trackers, and all six Project Plan tabs)
// imports from here so we can't drift. If Karbon adds a new Accounting
// type, we add it once in this file and every page picks it up.
//
// IMPORTANT: We deliberately match against an explicit allow-list rather
// than a prefix. A prefix check would silently admit any future
// "ACCT | …" or "Outsourced (NFP) | …" work_type without review (e.g.
// an experimental "ACCT | Sandbox" the team didn't intend to surface).

export const ACCT_WORK_TYPES = [
  "ACCT | 1099s",
  "ACCT | Bookkeeping",
  "ACCT | FP&A",
  "ACCT | Onboarding (BKPG)",
  "ACCT | Onboarding (PYRL)",
  "ACCT | Payroll",
  "Outsourced (NFP) | Bookkeeping",
  "Outsourced (NFP) | Onboarding",
] as const

export type AcctWorkType = (typeof ACCT_WORK_TYPES)[number]

// Lowercased lookup set so the membership check is case-insensitive and
// O(1). Karbon imports preserve casing but defensive comparisons are
// cheap and the constant is tiny.
const ACCT_WORK_TYPES_LOWER = new Set<string>(
  ACCT_WORK_TYPES.map((s) => s.toLowerCase()),
)

export function isAccountingWorkType(workType: string | null | undefined): boolean {
  if (!workType) return false
  return ACCT_WORK_TYPES_LOWER.has(workType.trim().toLowerCase())
}

// Sub-groupings used by individual trackers. Centralizing these keeps the
// dashboard label rows, the tracker page filters, and the API filters
// in lock-step — change a label here and every surface follows.

/**
 * Work types that drive the /accounting/bookkeeping tracker.
 *
 * NOTE: This was previously a single string (`BOOKKEEPING_WORK_TYPE`)
 * because there was only one bookkeeping work_type in Karbon. Adding
 * `Outsourced (NFP) | Bookkeeping` made it a true list, so this is now
 * a readonly tuple. The tracker now fetches with `?workTypes=A,B`.
 */
export const BOOKKEEPING_WORK_TYPES = [
  "ACCT | Bookkeeping",
  "Outsourced (NFP) | Bookkeeping",
] as const satisfies readonly AcctWorkType[]

/** Onboarding flows that drive the /onboarding tracker. */
export const ONBOARDING_WORK_TYPES = [
  "ACCT | Onboarding (BKPG)",
  "ACCT | Onboarding (PYRL)",
  "Outsourced (NFP) | Onboarding",
] as const satisfies readonly AcctWorkType[]

/** Payroll-related work types (recurring payroll + payroll onboarding). */
export const PAYROLL_WORK_TYPES = [
  "ACCT | Payroll",
  "ACCT | Onboarding (PYRL)",
] as const satisfies readonly AcctWorkType[]
