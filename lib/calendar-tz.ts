/**
 * Timezone-aware date helpers for the Team Calendar.
 *
 * Calendly delivers all times in UTC ISO format. We let the user pick a
 * display timezone and render every date through `Intl.DateTimeFormat`
 * with `timeZone` set, which is the simplest way to do "render this
 * instant in another tz" without pulling in moment-timezone or
 * date-fns-tz.
 */

/**
 * Curated list of common business timezones for the dropdown. We could
 * use `Intl.supportedValuesOf("timeZone")` to get all 400+ zones but
 * that's overwhelming UI; this hand-picked list covers most US firms
 * plus the major international hubs.
 */
export const COMMON_TIME_ZONES: { label: string; value: string; group: string }[] = [
  // Americas
  { group: "Americas", label: "Eastern (New York)", value: "America/New_York" },
  { group: "Americas", label: "Central (Chicago)", value: "America/Chicago" },
  { group: "Americas", label: "Mountain (Denver)", value: "America/Denver" },
  { group: "Americas", label: "Pacific (Los Angeles)", value: "America/Los_Angeles" },
  { group: "Americas", label: "Arizona (Phoenix, no DST)", value: "America/Phoenix" },
  { group: "Americas", label: "Alaska (Anchorage)", value: "America/Anchorage" },
  { group: "Americas", label: "Hawaii (Honolulu)", value: "Pacific/Honolulu" },
  { group: "Americas", label: "Toronto", value: "America/Toronto" },
  { group: "Americas", label: "Vancouver", value: "America/Vancouver" },
  { group: "Americas", label: "Mexico City", value: "America/Mexico_City" },
  { group: "Americas", label: "São Paulo", value: "America/Sao_Paulo" },
  // Europe
  { group: "Europe", label: "London", value: "Europe/London" },
  { group: "Europe", label: "Dublin", value: "Europe/Dublin" },
  { group: "Europe", label: "Paris", value: "Europe/Paris" },
  { group: "Europe", label: "Berlin", value: "Europe/Berlin" },
  { group: "Europe", label: "Madrid", value: "Europe/Madrid" },
  { group: "Europe", label: "Amsterdam", value: "Europe/Amsterdam" },
  { group: "Europe", label: "Zurich", value: "Europe/Zurich" },
  { group: "Europe", label: "Athens", value: "Europe/Athens" },
  // Asia / Oceania
  { group: "Asia / Oceania", label: "Dubai", value: "Asia/Dubai" },
  { group: "Asia / Oceania", label: "Mumbai (Kolkata)", value: "Asia/Kolkata" },
  { group: "Asia / Oceania", label: "Singapore", value: "Asia/Singapore" },
  { group: "Asia / Oceania", label: "Hong Kong", value: "Asia/Hong_Kong" },
  { group: "Asia / Oceania", label: "Tokyo", value: "Asia/Tokyo" },
  { group: "Asia / Oceania", label: "Sydney", value: "Australia/Sydney" },
  { group: "Asia / Oceania", label: "Auckland", value: "Pacific/Auckland" },
  // UTC reference
  { group: "Reference", label: "UTC", value: "UTC" },
]

/**
 * Returns the IANA timezone name the browser is running in (e.g.
 * "America/Chicago"). Falls back to UTC on the rare environments where
 * the API is unavailable.
 */
export function detectBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  } catch {
    return "UTC"
  }
}

/**
 * Format an ISO date string in a specific timezone. Mirrors the
 * options shape of `Intl.DateTimeFormat` so callers stay close to the
 * standard API.
 */
export function formatInTz(
  iso: string | Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" },
): string {
  const date = typeof iso === "string" ? new Date(iso) : iso
  if (Number.isNaN(date.getTime())) return ""
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone }).format(date)
}

/**
 * Format an event's start–end as a single human-readable string. When
 * the start and end fall on the same day in the chosen tz we collapse
 * to "Mon, Jan 6 · 9:00–10:00 AM"; otherwise we show both dates.
 */
export function formatRangeInTz(
  startIso: string,
  endIso: string,
  timeZone: string,
): string {
  const start = new Date(startIso)
  const end = new Date(endIso)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return ""
  // Determine same-day-ness in the *display* tz, not UTC.
  const ymdStart = formatInTz(start, timeZone, { year: "numeric", month: "2-digit", day: "2-digit" })
  const ymdEnd = formatInTz(end, timeZone, { year: "numeric", month: "2-digit", day: "2-digit" })
  const sameDay = ymdStart === ymdEnd

  const datePart = formatInTz(start, timeZone, { weekday: "short", month: "short", day: "numeric" })
  const startTime = formatInTz(start, timeZone, { hour: "numeric", minute: "2-digit" })
  const endTime = formatInTz(end, timeZone, { hour: "numeric", minute: "2-digit" })
  if (sameDay) return `${datePart} · ${startTime} – ${endTime}`
  const endDate = formatInTz(end, timeZone, { weekday: "short", month: "short", day: "numeric" })
  return `${datePart} ${startTime} – ${endDate} ${endTime}`
}

/**
 * Returns "YYYY-MM-DD" for the given instant in the given tz. We use
 * this as a stable bucket key when grouping events by date in views.
 */
export function tzDayKey(iso: string | Date, timeZone: string): string {
  const date = typeof iso === "string" ? new Date(iso) : iso
  // en-CA gives ISO-like YYYY-MM-DD ordering, which is exactly what we want.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

/**
 * Returns the day-of-week (0 = Sunday … 6 = Saturday) for the given
 * instant in the given tz. Useful for "what column does this event
 * belong to in the week grid".
 */
export function tzDayOfWeek(iso: string | Date, timeZone: string): number {
  const date = typeof iso === "string" ? new Date(iso) : iso
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date)
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday)
}

/**
 * Backwards-compatible alias. Some callers import `COMMON_TIMEZONES`
 * (no underscore) so we re-export the same array under that name. The
 * shape callers expect is `{ id, label }` so we map it here once.
 */
export const COMMON_TIMEZONES: { id: string; label: string }[] = COMMON_TIME_ZONES.map(
  (z) => ({ id: z.value, label: z.label }),
)

/**
 * Decompose an instant into year/month/day/hour/minute as observed in
 * `timeZone`. Used by the grid for cell-anchoring, month boundaries,
 * and "same day in tz" comparisons. Month is 1-indexed (Jan = 1) to
 * match how humans (and SQL) think about months.
 */
export function partsInTz(
  date: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0")
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    // "24" can appear in some locales for midnight — normalize to 0.
    hour: get("hour") % 24,
    minute: get("minute"),
  }
}

/**
 * Returns the offset (in minutes) between UTC and `timeZone` *at the
 * given instant*. Positive when `timeZone` is east of UTC. Computed by
 * formatting the instant with a long-offset token, e.g. "GMT-05:00",
 * which gives DST-aware results without external libraries.
 */
export function getTzOffsetMinutes(date: Date, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  })
  const part = fmt.formatToParts(date).find((p) => p.type === "timeZoneName")?.value ?? "GMT+00:00"
  // Examples: "GMT-05:00", "GMT", "GMT+11:00".
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(part)
  if (!m) return 0
  const sign = m[1] === "-" ? -1 : 1
  const hours = Number(m[2]) || 0
  const mins = Number(m[3]) || 0
  return sign * (hours * 60 + mins)
}

/**
 * Returns midnight local-to-`timeZone` for the day containing `date`,
 * expressed as a UTC `Date`. Used by the week/month grid to anchor
 * column starts. Implemented by computing the tz offset, subtracting
 * the wall-clock time-of-day, and re-adding the offset.
 */
export function startOfDayInTz(date: Date, timeZone: string): Date {
  const p = partsInTz(date, timeZone)
  // Anchor at 12:00 UTC on the wall-clock date and walk to 00:00 in the
  // target zone. The 12:00 anchor avoids landing on the previous day in
  // far-east zones.
  const guess = new Date(Date.UTC(p.year, p.month - 1, p.day, 12, 0, 0))
  const offsetMin = getTzOffsetMinutes(guess, timeZone)
  // 12:00 local minus 12 hours = 00:00 local; offsetMin moves us back
  // into UTC instant.
  return new Date(guess.getTime() - 12 * 60 * 60 * 1000 - offsetMin * 60 * 1000)
}

/**
 * Returns minutes-since-midnight for the given instant in the given tz.
 * The day-view grid uses this to position events vertically.
 */
export function tzMinutesOfDay(iso: string | Date, timeZone: string): number {
  const date = typeof iso === "string" ? new Date(iso) : iso
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date)
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0")
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0")
  // "24" can appear in some locales for midnight; normalize to 0.
  return ((h % 24) * 60 + m) % (24 * 60)
}
