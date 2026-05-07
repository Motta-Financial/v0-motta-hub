/**
 * Team-wide reminders source for the daily briefing.
 *
 * This is intentionally a hand-curated module — the firm's "things to know
 * this week" cadence (holidays, tax deadlines, Tommy Awards Thursday) doesn't
 * justify a dedicated DB table yet, and keeping it in code lets partners
 * tweak the calendar by editing one file + redeploying. When the list grows
 * past ~50 entries or non-engineers need to edit it, promote this to a
 * Supabase `team_reminders` table backed by an admin UI.
 *
 * All dates are interpreted in America/New_York (the firm's HQ). Recurring
 * weekly entries (e.g. Tommy Awards on Thursdays) are expanded at runtime
 * by `getRemindersForRange()`.
 */

export type ReminderKind = "holiday" | "tax" | "tommy" | "firm" | "other"

interface FixedReminder {
  /** ISO date YYYY-MM-DD (Eastern Time). */
  date: string
  kind: ReminderKind
  label: string
  notes?: string
}

interface RecurringWeeklyReminder {
  /** 0 = Sunday, 4 = Thursday, etc. */
  dayOfWeek: number
  kind: ReminderKind
  label: string
  notes?: string
}

/* ─────────────────────────────────────────────────────────────────────────
 * Fixed-date reminders
 * ───────────────────────────────────────────────────────────────────────
 * U.S. federal holidays + canonical IRS / firm tax deadlines for the
 * current and upcoming year. Edit annually.
 */

const FIXED_REMINDERS: FixedReminder[] = [
  // ── 2026 federal holidays ─────────────────────────────────────────────
  { date: "2026-01-01", kind: "holiday", label: "New Year's Day (Office Closed)" },
  { date: "2026-01-19", kind: "holiday", label: "Martin Luther King Jr. Day (Office Closed)" },
  { date: "2026-02-16", kind: "holiday", label: "Presidents' Day (Office Closed)" },
  { date: "2026-05-25", kind: "holiday", label: "Memorial Day (Office Closed)" },
  { date: "2026-06-19", kind: "holiday", label: "Juneteenth (Office Closed)" },
  { date: "2026-07-03", kind: "holiday", label: "Independence Day Observed (Office Closed)" },
  { date: "2026-09-07", kind: "holiday", label: "Labor Day (Office Closed)" },
  { date: "2026-10-12", kind: "holiday", label: "Columbus Day" },
  { date: "2026-11-11", kind: "holiday", label: "Veterans Day" },
  { date: "2026-11-26", kind: "holiday", label: "Thanksgiving (Office Closed)" },
  { date: "2026-11-27", kind: "holiday", label: "Day After Thanksgiving (Office Closed)" },
  { date: "2026-12-24", kind: "holiday", label: "Christmas Eve (Office Closed)" },
  { date: "2026-12-25", kind: "holiday", label: "Christmas Day (Office Closed)" },

  // ── 2027 federal holidays (so January reminders work in late December) ─
  { date: "2027-01-01", kind: "holiday", label: "New Year's Day (Office Closed)" },
  { date: "2027-01-18", kind: "holiday", label: "Martin Luther King Jr. Day (Office Closed)" },
  { date: "2027-02-15", kind: "holiday", label: "Presidents' Day (Office Closed)" },

  // ── 2026 IRS / firm tax deadlines ──────────────────────────────────────
  {
    date: "2026-01-15",
    kind: "tax",
    label: "Q4 2025 Estimated Tax Payment Due",
    notes: "Form 1040-ES — final estimated payment for tax year 2025.",
  },
  {
    date: "2026-01-31",
    kind: "tax",
    label: "1099 / W-2 Filing Deadline",
    notes: "Forms 1099-NEC, 1099-MISC (with NEC), and W-2 due to recipients and IRS/SSA.",
  },
  {
    date: "2026-03-16",
    kind: "tax",
    label: "S-Corp / Partnership Returns Due",
    notes: "Forms 1120-S and 1065 — extension Form 7004 if more time needed.",
  },
  {
    date: "2026-04-15",
    kind: "tax",
    label: "Individual & C-Corp Returns Due",
    notes: "Forms 1040, 1120 — and Q1 2026 estimated tax payment.",
  },
  {
    date: "2026-06-15",
    kind: "tax",
    label: "Q2 2026 Estimated Tax Payment Due",
    notes: "Form 1040-ES.",
  },
  {
    date: "2026-09-15",
    kind: "tax",
    label: "Extended S-Corp / Partnership Returns Due",
    notes: "Forms 1120-S and 1065 (extended). Q3 estimated payment also due.",
  },
  {
    date: "2026-10-15",
    kind: "tax",
    label: "Extended Individual / C-Corp Returns Due",
    notes: "Forms 1040 and 1120 (extended).",
  },
  {
    date: "2027-01-15",
    kind: "tax",
    label: "Q4 2026 Estimated Tax Payment Due",
    notes: "Form 1040-ES.",
  },
]

/* ─────────────────────────────────────────────────────────────────────────
 * Recurring weekly reminders
 * ─────────────────────────────────────────────────────────────────────── */

const RECURRING_WEEKLY: RecurringWeeklyReminder[] = [
  {
    dayOfWeek: 4, // Thursday
    kind: "tommy",
    label: "Tommy Awards Ballots Due",
    notes:
      "Cast your ballot before Friday at noon Eastern. Recognize teammates who went the extra mile this week.",
  },
]

/* ─────────────────────────────────────────────────────────────────────────
 * Public API
 * ─────────────────────────────────────────────────────────────────────── */

export interface ResolvedReminder {
  /** ISO date YYYY-MM-DD. */
  date: string
  /** "Mon, Jan 13" style label for inline display. */
  dateLabel: string
  /** "Today", "Tomorrow", or weekday name for relative phrasing. */
  relativeLabel: string
  kind: ReminderKind
  label: string
  notes?: string
}

/**
 * Returns every reminder (fixed + recurring) that falls inclusively within
 * `[start, end]`, sorted ascending by date. Dates are compared as
 * America/New_York calendar days so a 7 AM cron tick doesn't accidentally
 * skip "today" because UTC is already on the next day.
 */
export function getRemindersForRange(start: Date, end: Date): ResolvedReminder[] {
  const out: ResolvedReminder[] = []
  const startKey = ymdInTz(start, "America/New_York")
  const endKey = ymdInTz(end, "America/New_York")

  // Fixed reminders — simple string compare on YYYY-MM-DD.
  for (const r of FIXED_REMINDERS) {
    if (r.date >= startKey && r.date <= endKey) {
      out.push(decorate(r.date, r.kind, r.label, r.notes))
    }
  }

  // Recurring weekly — walk each day in the window.
  const dayCursor = new Date(start)
  // Normalize to start-of-day Eastern by re-anchoring on the YMD parts.
  const [sY, sM, sD] = startKey.split("-").map(Number)
  dayCursor.setUTCFullYear(sY, sM - 1, sD)
  dayCursor.setUTCHours(12, 0, 0, 0) // noon UTC ≈ midday Eastern, avoids DST flips

  while (true) {
    const ymd = ymdInTz(dayCursor, "America/New_York")
    if (ymd > endKey) break
    const dow = new Date(`${ymd}T12:00:00-05:00`).getDay()
    for (const r of RECURRING_WEEKLY) {
      if (r.dayOfWeek === dow) {
        out.push(decorate(ymd, r.kind, r.label, r.notes))
      }
    }
    dayCursor.setUTCDate(dayCursor.getUTCDate() + 1)
  }

  // De-dupe (a fixed entry on the same day as a recurring one shouldn't
  // double up) and sort.
  const seen = new Set<string>()
  return out
    .filter((r) => {
      const key = `${r.date}|${r.kind}|${r.label}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/* ─────────────────────────────────────────────────────────────────────────
 * Helpers
 * ─────────────────────────────────────────────────────────────────────── */

function decorate(
  date: string,
  kind: ReminderKind,
  label: string,
  notes?: string,
): ResolvedReminder {
  // Build display labels in Eastern Time so "Today"/"Tomorrow" line up
  // with the firm's working day, regardless of where Vercel runs the cron.
  const todayKey = ymdInTz(new Date(), "America/New_York")
  const tomorrow = new Date()
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  const tomorrowKey = ymdInTz(tomorrow, "America/New_York")

  const dateObj = new Date(`${date}T12:00:00-05:00`)
  const dateLabel = dateObj.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  })

  let relativeLabel: string
  if (date === todayKey) relativeLabel = "Today"
  else if (date === tomorrowKey) relativeLabel = "Tomorrow"
  else
    relativeLabel = dateObj.toLocaleDateString("en-US", {
      weekday: "long",
      timeZone: "America/New_York",
    })

  return { date, dateLabel, relativeLabel, kind, label, notes }
}

function ymdInTz(d: Date, timeZone: string): string {
  // en-CA gives us YYYY-MM-DD natively from Intl, which is exactly what we
  // want for lexicographic comparison.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d)
}
