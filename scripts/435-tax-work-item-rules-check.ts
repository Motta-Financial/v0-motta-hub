/**
 * Tax work-item rules — offline self-check (no network, no database).
 *
 * Exercises the pure rules in `lib/karbon/tax-work-item-defaults.ts` that
 * decide what the Hub sets on a Karbon work item right after creating it:
 * which work types are tax preparation, the tax year, the 12/31 start
 * date, the statutory due / deadline date, and which lead statuses may be
 * advanced to "meeting scheduled".
 *
 * The expected values are the firm's own conventions as they stand in
 * Karbon (e.g. `TAX | Individual (1040) | … | 2026` starts 2026-12-31 and
 * is due 2027-04-15; 1065s and 1120-Ss are due 3/15).
 *
 * The end-to-end behaviour built on these rules (the PATCHes that go to
 * Karbon, and when a booking advances a work item) is covered by
 * `scripts/436-booking-and-karbon-flows-check.ts`.
 *
 * Exits 1 when any check fails.
 *
 *   npx tsx scripts/435-tax-work-item-rules-check.ts
 */
import {
  AWAITING_MEETING_SECONDARY_STATUS,
  classifyTaxPrepWorkType,
  defaultProspectTaxYear,
  formatIsoDateForDisplay,
  isAwaitingIntakeStatusName,
  isMeetingScheduledStatusName,
  isPreMeetingLeadStatusName,
  isUntouchedTemplateStatus,
  LEAD_PRIMARY_STATUS,
  MEETING_SCHEDULED_SECONDARY_STATUS,
  normalizePrimaryStatus,
  parseTaxYear,
  resolveTaxYear,
  TAX_RETURN_DUE_DATES,
  taxReturnSchedule,
  taxYearFromTitle,
  toKarbonDateTime,
  toKarbonPrimaryStatus,
} from "../lib/karbon/tax-work-item-defaults"

let failures = 0
let passes = 0

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    passes += 1
  } else {
    failures += 1
    console.error(`FAIL  ${label}\n      expected ${e}\n      actual   ${a}`)
  }
}

// ── Which work types are tax preparation (the tenant's real names) ──────
const WORK_TYPES: Array<[string, string | null]> = [
  ["TAX | Individual (1040)", "1040"],
  ["TAX | Individual (1040c)", "1040"],
  ["TAX | Partnership (1065)", "1065"],
  ["Tax | S-Corp (1120S)", "1120S"],
  ["TAX | C-Corp (1120)", "1120"],
  ["TAX | Non-Profit & Exempt (990)", "990"],
  ["TAX | Trusts & Estates", "1041"],
  ["Tax | 709 (Gift)", "709"],
  // Tax work with no single statutory filing date — left alone.
  ["TAX | Estimates & Forecasting", null],
  ["TAX | IRS Support", null],
  ["TAX | Planning & Advisory", null],
  ["TAX | S-Corp Election", null],
  ["TAX | Stock Comp", null],
  ["TAX | Foreign", null],
  // Not tax at all.
  ["ACCT | Bookkeeping", null],
  ["Payroll", null],
  ["ADVISORY | 1040 Review", null],
  ["", null],
]
for (const [name, expected] of WORK_TYPES) {
  check(`classify "${name}"`, classifyTaxPrepWorkType(name), expected)
}
check("classify null", classifyTaxPrepWorkType(null), null)
// Renames must keep working — matching is on the form number.
check("classify renamed S-Corp", classifyTaxPrepWorkType("TAX | S Corporation (1120-S)"), "1120S")
check("classify 990-EZ", classifyTaxPrepWorkType("TAX | Exempt Org (990-EZ)"), "990")
check("classify fiduciary 1041", classifyTaxPrepWorkType("TAX | Fiduciary (1041)"), "1041")

// ── Dates: start 12/31 of the tax year, due + deadline on the filing date ─
check("1040 TY2026", taxReturnSchedule("1040", 2026), {
  kind: "1040",
  taxYear: 2026,
  startDate: "2026-12-31",
  dueDate: "2027-04-15",
  deadlineDate: "2027-04-15",
})
check("1040 TY2025 due", taxReturnSchedule("1040", 2025)?.dueDate, "2026-04-15")
check("1065 TY2025 due", taxReturnSchedule("1065", 2025)?.dueDate, "2026-03-15")
check("1120S TY2026 due", taxReturnSchedule("1120S", 2026)?.dueDate, "2027-03-15")
check("1120 TY2026 due", taxReturnSchedule("1120", 2026)?.dueDate, "2027-04-15")
check("1041 TY2026 due", taxReturnSchedule("1041", 2026)?.dueDate, "2027-04-15")
check("709 TY2026 due", taxReturnSchedule("709", 2026)?.dueDate, "2027-04-15")
check("1065 start", taxReturnSchedule("1065", 2025)?.startDate, "2025-12-31")
// The deadline is the external (IRS) date and always equals the due date.
for (const kind of ["1040", "1065", "1120S", "1120", "1041", "709"] as const) {
  const s = taxReturnSchedule(kind, 2026)
  check(`${kind}: deadline equals due date`, s?.deadlineDate, s?.dueDate)
  check(`${kind}: starts 12/31 of the tax year`, s?.startDate, "2026-12-31")
}
// Form 990 is the one return with no single date: exempt organizations are
// mostly fiscal-year filers, so the Hub leaves those dates as entered.
check("990 has no automatic dates", taxReturnSchedule("990", 2026), null)
check("990 rule is explicitly null", TAX_RETURN_DUE_DATES["990"], null)
check("karbon datetime", toKarbonDateTime("2026-12-31"), "2026-12-31T00:00:00Z")
check("karbon datetime passthrough", toKarbonDateTime("2026-12-31T05:00:00Z"), "2026-12-31T05:00:00Z")
check("display date", formatIsoDateForDisplay("2027-04-15"), "Apr 15, 2027")
check("display date from timestamp", formatIsoDateForDisplay("2026-12-31T00:00:00Z"), "Dec 31, 2026")

// ── Default tax year: last year through 4/15 (US Eastern), else this year ─
const at = (iso: string) => defaultProspectTaxYear(new Date(iso))
check("default TY — Nov 25 2026", at("2026-11-25T18:00:00Z"), 2026)
check("default TY — Jun 18 2026", at("2026-06-18T15:00:00Z"), 2026)
check("default TY — Jan 2 2027", at("2027-01-02T15:00:00Z"), 2026)
check("default TY — Feb 20 2027", at("2027-02-20T15:00:00Z"), 2026)
check("default TY — Apr 15 2027 (deadline day)", at("2027-04-15T20:00:00Z"), 2026)
check("default TY — Apr 16 2027", at("2027-04-16T15:00:00Z"), 2027)
check("default TY — Dec 31 2026 11pm ET", at("2027-01-01T04:00:00Z"), 2026)
// 03:00 UTC on Jan 1 is still Dec 31 in New York — must not flip a day early.
check("default TY — Jan 1 2027 03:00 UTC is still 2026 in ET", at("2027-01-01T03:00:00Z"), 2026)
check("default TY — Jan 1 2027 06:00 UTC is Jan 1 ET", at("2027-01-01T06:00:00Z"), 2026)
// 02:00 UTC on Apr 16 is 10pm Apr 15 in New York — still filing season.
check("default TY — Apr 16 2027 02:00 UTC is Apr 15 ET", at("2027-04-16T02:00:00Z"), 2026)

// ── Tax year parsing ────────────────────────────────────────────────────
check("parse '2026'", parseTaxYear("2026"), 2026)
check("parse ' 2025 '", parseTaxYear(" 2025 "), 2025)
check("parse 'FY2026'", parseTaxYear("FY2026"), 2026)
check("parse 'TY 2024'", parseTaxYear("TY 2024"), 2024)
check("parse 'LEAD'", parseTaxYear("LEAD"), null)
check("parse '[NEW CLIENT]'", parseTaxYear("[NEW CLIENT]"), null)
check("parse ''", parseTaxYear(""), null)
check("parse null", parseTaxYear(null), null)
check("parse number", parseTaxYear(2027), 2027)
check("parse phone-like digits", parseTaxYear("5552026123"), null)
check("parse '1999'", parseTaxYear("1999"), null)
check("parse range takes last", parseTaxYear("2025-2026"), 2026)
// A year embedded in a longer number is not a year (the parser avoids
// regex lookbehind because this module ships to the browser).
check("parse '12026'", parseTaxYear("12026"), null)
check("parse '20261'", parseTaxYear("20261"), null)
check("parse 'x2026y'", parseTaxYear("x2026y"), 2026)
check("parse '2100'", parseTaxYear("2100"), null)
check("parse 'Dec 31, 2026'", parseTaxYear("Dec 31, 2026"), 2026)

check("title year", taxYearFromTitle("TAX | Individual (1040) | Doe, Jane | 2026"), 2026)
check("title LEAD", taxYearFromTitle("TAX | Individual (1040) | Doe, Jane | LEAD"), null)
check(
  "title: year in client name is ignored",
  taxYearFromTitle("TAX | Partnership (1065) | Studio 2020 LLC | 2025"),
  2025,
)
check(
  "title: client name year alone is not a tax year",
  taxYearFromTitle("TAX | Partnership (1065) | Studio 2020 LLC | LEAD"),
  null,
)
check("title without pipes, trailing year", taxYearFromTitle("Smith 1040 2025"), 2025)
check("title without pipes, no trailing year", taxYearFromTitle("2025 Smith return"), null)
check("title empty", taxYearFromTitle(""), null)

const now = new Date("2026-11-25T18:00:00Z")
check("resolve: fiscal year wins", resolveTaxYear({ fiscalYear: "2025", title: "x | 2027", now }), {
  taxYear: 2025,
  source: "fiscal_year",
})
check("resolve: title next", resolveTaxYear({ fiscalYear: "LEAD", title: "x | y | 2027", now }), {
  taxYear: 2027,
  source: "title",
})
check("resolve: default last", resolveTaxYear({ fiscalYear: "LEAD", title: "x | y | LEAD", now }), {
  taxYear: 2026,
  source: "default",
})
check(
  "resolve: filing-season default",
  resolveTaxYear({ fiscalYear: "", now: new Date("2027-02-10T15:00:00Z") }),
  { taxYear: 2026, source: "default" },
)

// ── Lead statuses (the tenant's real secondary status names) ────────────
check("meeting status: Lead | Meeting Schd", isMeetingScheduledStatusName("Lead | Meeting Schd"), true)
check("meeting status: renamed", isMeetingScheduledStatusName("Lead | Meeting Scheduled"), true)
check("meeting status: Awaiting Intake", isMeetingScheduledStatusName("Lead | Awaiting Intake"), false)
check("meeting status: null", isMeetingScheduledStatusName(null), false)

check("meeting status: an unrelated 'meeting' status", isMeetingScheduledStatusName("MOTTA | Meeting Notes Due"), false)
check("fallback names match their own matchers", [
  isMeetingScheduledStatusName(MEETING_SCHEDULED_SECONDARY_STATUS),
  isAwaitingIntakeStatusName(AWAITING_MEETING_SECONDARY_STATUS),
  LEAD_PRIMARY_STATUS,
], [true, true, "InProgress"])

check("awaiting intake: exact", isAwaitingIntakeStatusName("Lead | Awaiting Intake"), true)
check("awaiting intake: casing + spacing", isAwaitingIntakeStatusName("  LEAD |  awaiting   intake "), true)
check("awaiting intake: Meeting Schd", isAwaitingIntakeStatusName("Lead | Meeting Schd"), false)
check("awaiting intake: not a lead status", isAwaitingIntakeStatusName("CLIENT | Awaiting Intake"), false)
check("awaiting intake: null", isAwaitingIntakeStatusName(null), false)

// The firm's lead funnel, in SOP order: Prospect → Awaiting Intake →
// Meeting Schd → NEED DEBRIEF → Discovery (Sent) → Discovery (Rec'd) → …
// Only the steps BEFORE "Meeting Schd" may be advanced by a booking.
const PRE_MEETING: Array<[string | null, boolean]> = [
  ["Lead | Awaiting Intake", true],
  ["LEAD | Prospect", true],
  ["lead |  prospect", true],
  ["Prospect", true],
  ["Lead", true],
  // Discovery comes AFTER the meeting — a follow-up booking must not pull
  // one of these back to "Meeting Schd".
  ["Lead | Discovery (Sent)", false],
  ["Lead | Discovery (Rec'd)", false],
  ["Lead | Something New", false],
  // Already there, or further along — must never be touched.
  ["Lead | Meeting Schd", false],
  ["MOTTA | NEED DEBRIEF", false],
  ["MOTTA | PREPARE PROPOSAL", false],
  ["Proposal | Sent", false],
  ["SIGNED | Send Requests", false],
  ["Client Requests | Rec'd", false],
  ["MOTTA | Actively Prepping", false],
  ["FINAL | Ready to eFile", false],
  ["COMPLETE | Filed & Billed", false],
  ["RETURNING | ENGAGE FOR 26", false],
  ["Send Client Requests", false],
  ["", false],
  [null, false],
]
for (const [name, expected] of PRE_MEETING) {
  check(`pre-meeting lead status "${name}"`, isPreMeetingLeadStatusName(name), expected)
}

check("normalize 'In Progress'", normalizePrimaryStatus("In Progress"), "inprogress")
check("normalize 'InProgress'", normalizePrimaryStatus("InProgress"), "inprogress")
check("normalize 'Completed'", normalizePrimaryStatus("Completed"), "completed")
check("normalize null", normalizePrimaryStatus(null), "")

// Karbon's write endpoints document the un-spaced enum form.
check("primary → 'In Progress'", toKarbonPrimaryStatus("In Progress"), "InProgress")
check("primary → 'ready to start'", toKarbonPrimaryStatus("ready to start"), "ReadyToStart")
check("primary → 'Planned'", toKarbonPrimaryStatus("Planned"), "Planned")
check("primary → 'Waiting'", toKarbonPrimaryStatus(" waiting "), "Waiting")
check("primary → 'Completed'", toKarbonPrimaryStatus("COMPLETED"), "Completed")
check("primary → unknown passes through", toKarbonPrimaryStatus("On Hold"), "On Hold")
check("primary → null", toKarbonPrimaryStatus(null), "")

// A Hub-created work item nobody has touched yet sits on the template's
// default: "Planned" (or "Ready To Start") with no secondary status.
check("untouched: Planned / none", isUntouchedTemplateStatus("Planned", null), true)
check("untouched: Ready To Start / blank", isUntouchedTemplateStatus("Ready To Start", "  "), true)
check("untouched: Planned + a secondary", isUntouchedTemplateStatus("Planned", "Lead | Awaiting Intake"), false)
check("untouched: In Progress / none", isUntouchedTemplateStatus("In Progress", null), false)
check("untouched: Completed / none", isUntouchedTemplateStatus("Completed", null), false)
check("untouched: nothing at all", isUntouchedTemplateStatus(null, null), false)

console.log(`${passes} passed, ${failures} failed`)
process.exit(failures > 0 ? 1 : 0)
