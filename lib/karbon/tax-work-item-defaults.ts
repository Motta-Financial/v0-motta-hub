/**
 * Tax-preparation work item conventions — the tax year, the dates and the
 * lead status a Hub-created Karbon work item should carry.
 *
 * Pure functions only (no Supabase, no Karbon, no `server-only`), so the
 * same rules drive the server-side post-create update
 * (`lib/karbon/finalize-work-item.ts`) and the client-side previews in the
 * intake sheet / prospect page / work-item builder.
 *
 * ── Where the rules come from ───────────────────────────────────────────
 * They are the firm's existing practice, read off the work items already
 * in Karbon rather than invented here:
 *
 *   TAX | Individual (1040)  | … | 2026   start 2026-12-31   due 2027-04-15
 *   TAX | Partnership (1065) | … | 2025   start 2025-12-31   due 2026-03-15
 *   Tax | S-Corp (1120S)     | … | 2025   start 2025-12-31   due 2026-03-15
 *   TAX | C-Corp (1120)      | … | 2026   start 2026-12-31   due 2027-04-15
 *
 * i.e. the work item for tax year N starts on 12/31/N — the last day of
 * the period the return covers — and is due on the return's statutory
 * filing date in N+1. Due date and deadline carry the same date.
 *
 * The firm books the NOMINAL date (3/15, 4/15) even when it lands on a
 * weekend (1065s for 2025 are in Karbon as due Sunday 2026-03-15), so no
 * weekend/holiday roll-forward is applied. Matching what is already in
 * Karbon keeps Hub-created items sorting alongside the rest of the season.
 */

/** Return families the firm prepares, keyed by IRS form. */
export type TaxReturnKind = "1040" | "1065" | "1120S" | "1120" | "1041" | "990" | "709"

/**
 * Original (un-extended) statutory due date for a CALENDAR-YEAR filer,
 * expressed as a month/day in the year after the tax year.
 *
 * `null` = no automatic dates. Form 990 is the one return the firm does
 * not book on a single date: exempt organizations mostly run fiscal
 * years, and the 990 work items already in Karbon are due 2/15, 4/15,
 * 6/30, 10/15… — never the nominal 5/15. Guessing a date there would be
 * wrong more often than right, so those keep whatever the teammate (or
 * the template) set.
 */
export const TAX_RETURN_DUE_DATES: Record<
  TaxReturnKind,
  { month: number; day: number; form: string } | null
> = {
  "1040": { month: 4, day: 15, form: "Form 1040" },
  "1065": { month: 3, day: 15, form: "Form 1065" },
  "1120S": { month: 3, day: 15, form: "Form 1120-S" },
  "1120": { month: 4, day: 15, form: "Form 1120" },
  "1041": { month: 4, day: 15, form: "Form 1041" },
  "990": null,
  "709": { month: 4, day: 15, form: "Form 709" },
}

/**
 * Map a Karbon work type NAME to the return it prepares, or `null` when
 * the work type is not tax preparation.
 *
 * The tenant's tax work types are all prefixed `TAX | …` (two of them are
 * cased `Tax | …`). Only the eight return-preparation types resolve here —
 * the same set as `TAX_RETURN_WORK_TYPES` in `lib/karbon-api.ts`. The rest
 * (`Estimates & Forecasting`, `IRS Support`, `Planning & Advisory`,
 * `S-Corp Election`, `Stock Comp`, `Foreign`) have no single statutory
 * filing date, so they return `null` and keep whatever dates the teammate
 * or the template set.
 *
 * Matching is on the form number rather than the label so a rename such
 * as "TAX | S-Corp (1120S)" → "TAX | S Corporation (1120-S)" keeps working,
 * and so "TAX | S-Corp Election" (no form number) is correctly excluded.
 */
export function classifyTaxPrepWorkType(workTypeName: string | null | undefined): TaxReturnKind | null {
  const name = (workTypeName ?? "").trim().toLowerCase()
  if (!/^tax\b/.test(name)) return null

  if (/\b1040/.test(name)) return "1040" // "(1040)" and "(1040c)"
  if (/\b1120-?s\b/.test(name)) return "1120S" // must precede the bare 1120 check
  if (/\b1120\b/.test(name)) return "1120"
  if (/\b1065\b/.test(name)) return "1065"
  if (/\b1041\b/.test(name) || /\btrusts?\b.*\bestates?\b/.test(name) || /\bfiduciar/.test(name)) return "1041"
  if (/\b990/.test(name)) return "990" // "(990)", "(990-EZ)", "(990PF)"
  if (/\b709\b/.test(name)) return "709"
  return null
}

export interface TaxReturnSchedule {
  kind: TaxReturnKind
  taxYear: number
  /** 12/31 of the tax year — `YYYY-MM-DD`. */
  startDate: string
  /** Statutory filing date in the following year — `YYYY-MM-DD`. */
  dueDate: string
  /** Same date as `dueDate`: the external (IRS) deadline. */
  deadlineDate: string
}

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

/**
 * The firm-convention dates for a return of `kind` covering `taxYear`,
 * or `null` when that return has no conventional date (see 990 above).
 */
export function taxReturnSchedule(kind: TaxReturnKind, taxYear: number): TaxReturnSchedule | null {
  const rule = TAX_RETURN_DUE_DATES[kind]
  if (!rule) return null
  const due = `${taxYear + 1}-${pad2(rule.month)}-${pad2(rule.day)}`
  return {
    kind,
    taxYear,
    startDate: `${taxYear}-12-31`,
    dueDate: due,
    deadlineDate: due,
  }
}

/** Calendar year/month/day "now" in the firm's timezone (US Eastern). */
function easternYmd(now: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return { year: get("year"), month: get("month"), day: get("day") }
}

/**
 * The tax year a NEW prospect's return most plausibly covers.
 *
 *   • Jan 1 – Apr 15  → last year. Someone who walks in during filing
 *     season needs the return that is due this April. Defaulting to the
 *     calendar year here (the old behaviour) produced a work item for the
 *     wrong year, starting a full twelve months late.
 *   • Apr 16 – Dec 31 → this year. That is the firm's existing practice
 *     (a June 2026 intake is "… | 2026", starting 12/31/2026).
 *
 * Always a default: the teammate can type a different year, and an
 * explicit year in the fiscal-year field or the title always wins.
 */
export function defaultProspectTaxYear(now: Date = new Date()): number {
  const { year, month, day } = easternYmd(now)
  const inFilingSeason = month < 4 || (month === 4 && day <= 15)
  return inFilingSeason ? year - 1 : year
}

/** A plausible tax year — guards against phone numbers, zip codes, etc. */
function isPlausibleTaxYear(n: number): boolean {
  return Number.isInteger(n) && n >= 2000 && n <= 2099
}

/**
 * Pull a four-digit year out of free text ("2026", "FY2026", "TY 2025").
 * Returns `null` for values like "LEAD" or "[NEW CLIENT]", which the
 * fiscal-year field explicitly allows.
 */
export function parseTaxYear(text: string | number | null | undefined): number | null {
  if (text === null || text === undefined) return null
  // "A 20xx that is not part of a longer number." Written with a leading
  // non-digit group rather than a lookbehind: this module ships to the
  // browser, and Safari before 16.4 refuses to parse a script that
  // contains a lookbehind at all.
  const re = /(?:^|\D)(20\d{2})(?!\d)/g
  let last: string | null = null
  for (let m = re.exec(String(text)); m; m = re.exec(String(text))) last = m[1]
  if (last === null) return null
  const year = Number(last)
  return isPlausibleTaxYear(year) ? year : null
}

/**
 * The tax year named by a work item title. Titles follow
 * `<work type> | <client> | <year>`, so only the LAST pipe-delimited
 * segment is consulted — a client called "Studio 2020 LLC" must not be
 * mistaken for the 2020 tax year.
 */
export function taxYearFromTitle(title: string | null | undefined): number | null {
  const raw = (title ?? "").trim()
  if (!raw) return null
  if (raw.includes("|")) {
    return parseTaxYear(raw.split("|").pop())
  }
  const trailing = raw.match(/(?:^|\D)(20\d{2})\s*$/)
  return trailing ? parseTaxYear(trailing[1]) : null
}

/**
 * Resolve the tax year for a work item: an explicit fiscal-year entry
 * wins, then the year in the title, then the seasonal default.
 */
export function resolveTaxYear(input: {
  fiscalYear?: string | number | null
  title?: string | null
  now?: Date
}): { taxYear: number; source: "fiscal_year" | "title" | "default" } {
  const explicit = parseTaxYear(input.fiscalYear)
  if (explicit !== null) return { taxYear: explicit, source: "fiscal_year" }
  const fromTitle = taxYearFromTitle(input.title)
  if (fromTitle !== null) return { taxYear: fromTitle, source: "title" }
  return { taxYear: defaultProspectTaxYear(input.now), source: "default" }
}

/** `YYYY-MM-DD` → the midnight-UTC timestamp Karbon's API expects. */
export function toKarbonDateTime(isoDate: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(isoDate) ? `${isoDate}T00:00:00Z` : isoDate
}

/** "2027-04-15" → "Apr 15, 2027" for UI previews (no timezone drift). */
export function formatIsoDateForDisplay(isoDate: string): string {
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return isoDate
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`
}

/* ─────────────────────────────────────────────────────────────────────────
 * Lead statuses
 * ───────────────────────────────────────────────────────────────────────
 * Karbon statuses are a fixed PrimaryStatus plus a tenant-defined
 * SecondaryStatus that must be enabled for the work item's work type.
 *
 * The firm's lead funnel, in SOP order (components/busy-season-tracker.tsx):
 *
 *   2  LEAD | Prospect           introduced, no serious interest yet
 *   3  Lead | Awaiting Intake    intake form or Calendly link sent
 *   4  Lead | Meeting Schd       client has scheduled a meeting
 *   5  MOTTA | NEED DEBRIEF      (after the meeting)
 *   6  Lead | Discovery (Sent)   discovery requests sent to client
 *   7  Lead | Discovery (Rec'd)  client sent prior-year returns
 *
 * So for a NEW prospect work item there are exactly two right answers,
 * and they are what teammates have been setting by hand on every
 * Hub-created prospect work item so far:
 *
 *   • a Calendly meeting is on the books  → Lead | Meeting Schd
 *   • no meeting yet                      → Lead | Awaiting Intake
 *
 * The names below are FALLBACKS — the finalize step looks the live name
 * up in the `work_status` mirror first so a rename in Karbon doesn't
 * silently break the automation.
 */

/** Where a prospect is, as far as the Hub can tell when the work item is created. */
export type LeadStage = "meeting_scheduled" | "awaiting_meeting"

/** PrimaryStatus every `Lead | …` secondary status hangs under. */
export const LEAD_PRIMARY_STATUS = "InProgress"

/** The prospect has a Calendly meeting booked. */
export const MEETING_SCHEDULED_SECONDARY_STATUS = "Lead | Meeting Schd"

/** The prospect has the intake / booking link but no meeting yet. */
export const AWAITING_MEETING_SECONDARY_STATUS = "Lead | Awaiting Intake"

function normalizeStatusName(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase().replace(/\s+/g, " ")
}

/** Matches the tenant's "meeting scheduled" lead status by meaning, not exact spelling. */
export function isMeetingScheduledStatusName(name: string | null | undefined): boolean {
  const n = normalizeStatusName(name)
  return /\bmeeting\b/.test(n) && /\b(schd|sched|scheduled|booked)\b/.test(n)
}

/** Matches the tenant's "awaiting intake" lead status. */
export function isAwaitingIntakeStatusName(name: string | null | undefined): boolean {
  const n = normalizeStatusName(name)
  return /^lead\b/.test(n) && /\bawaiting intake\b/.test(n)
}

/**
 * True for the lead statuses that sit BEFORE a meeting is on the calendar
 * — "LEAD | Prospect", "Lead | Awaiting Intake", and the bare "Lead" /
 * "Prospect". A work item in one of these may be advanced to "meeting
 * scheduled" when the prospect books.
 *
 * Deliberately an allow-list. "Lead | Discovery (Sent)" and "Lead |
 * Discovery (Rec'd)" also start with "Lead" but come AFTER the meeting
 * (steps 6–7 above); pulling one of those back to "Meeting Schd" because
 * the prospect booked a follow-up call would undo a teammate's progress.
 */
export function isPreMeetingLeadStatusName(name: string | null | undefined): boolean {
  const n = normalizeStatusName(name)
  if (!n) return false
  if (n === "lead" || n === "prospect") return true
  return /^lead \| (prospect|awaiting intake)$/.test(n)
}

/** Karbon returns PrimaryStatus as "In Progress" or "InProgress" depending on the endpoint. */
export function normalizePrimaryStatus(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, "").toLowerCase()
}

/**
 * The PrimaryStatus spelling Karbon's write endpoints document
 * (`Planned | ReadyToStart | InProgress | Waiting | Completed`). They
 * accept the spaced form too, but sending the enum form removes the
 * question. Unknown values pass through untouched.
 */
export function toKarbonPrimaryStatus(value: string | null | undefined): string {
  const canonical: Record<string, string> = {
    planned: "Planned",
    readytostart: "ReadyToStart",
    inprogress: "InProgress",
    waiting: "Waiting",
    completed: "Completed",
  }
  return canonical[normalizePrimaryStatus(value)] ?? (value ?? "").trim()
}

/**
 * An untouched template default: no secondary status and a primary that
 * means "not started". The 1040 prospect template creates work items as
 * `Planned` with nothing else, so a Hub-created item that nobody has
 * touched yet is in exactly this state — and may be advanced when the
 * prospect books.
 */
export function isUntouchedTemplateStatus(
  primary: string | null | undefined,
  secondary: string | null | undefined,
): boolean {
  if (normalizeStatusName(secondary)) return false
  const p = normalizePrimaryStatus(primary)
  return p === "planned" || p === "readytostart"
}
