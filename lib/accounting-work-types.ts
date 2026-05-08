// Single source of truth for the canonical Accounting (ACCT) Karbon
// work_types. Mirrors the Karbon Work Types admin screen:
//
//   ACCT | 1099s
//   ACCT | Bookkeeping
//   ACCT | FP&A
//   ACCT | Onboarding (BKPG)
//   ACCT | Onboarding (PYRL)
//   ACCT | Payroll
//
// Every Accounting surface in the app (the /accounting overview cards,
// the Bookkeeping & Onboarding trackers, and all six Project Plan tabs)
// imports from here so we can't drift. If Karbon adds a new ACCT type,
// we add it once in this file and every page picks it up.
//
// IMPORTANT: We deliberately match against an explicit allow-list rather
// than a `startsWith("ACCT |")` prefix. A prefix check would silently
// admit any future ACCT work_type without review (e.g. an experimental
// "ACCT | Sandbox" the team didn't intend to surface in dashboards).

export const ACCT_WORK_TYPES = [
  "ACCT | 1099s",
  "ACCT | Bookkeeping",
  "ACCT | FP&A",
  "ACCT | Onboarding (BKPG)",
  "ACCT | Onboarding (PYRL)",
  "ACCT | Payroll",
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

/** Exact work_type used by the /accounting/bookkeeping tracker. */
export const BOOKKEEPING_WORK_TYPE = "ACCT | Bookkeeping" satisfies AcctWorkType

/** Onboarding flows that drive the /onboarding tracker. */
export const ONBOARDING_WORK_TYPES = [
  "ACCT | Onboarding (BKPG)",
  "ACCT | Onboarding (PYRL)",
] as const satisfies readonly AcctWorkType[]

/** Payroll-related work types (recurring payroll + payroll onboarding). */
export const PAYROLL_WORK_TYPES = [
  "ACCT | Payroll",
  "ACCT | Onboarding (PYRL)",
] as const satisfies readonly AcctWorkType[]
