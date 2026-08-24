/**
 * DST-aware Eastern Time guards for Vercel Cron routes.
 *
 * Vercel Cron schedules are interpreted in UTC and have no notion of
 * timezones, so any job that needs to fire at a specific Eastern-Time
 * wall-clock hour has to be scheduled at BOTH possible UTC hours
 * (EST = UTC-5, EDT = UTC-4) and then guarded inside the route so it
 * only does work on the invocation that matches the target hour in
 * America/New_York for the current date.
 *
 * Pattern in a cron route:
 *
 *   if (!isEasternHourAndWeekday(15, 4)) {
 *     return NextResponse.json({ skipped: true, reason: "wrong eastern hour" })
 *   }
 */

/**
 * Returns the current hour (0-23) and ISO weekday (1=Mon ... 7=Sun, or
 * equivalent of Date#getDay where Sunday=0) for the given instant in
 * America/New_York. Uses Intl.DateTimeFormat so it handles EST/EDT
 * automatically with no external library.
 */
export function nowInEastern(now: Date = new Date()): {
  hour: number
  minute: number
  /** 0 = Sunday, 1 = Monday, ... 6 = Saturday (matches Date#getDay). */
  weekday: number
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  })
  const parts = fmt.formatToParts(now)
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "0"
  const minuteStr = parts.find((p) => p.type === "minute")?.value ?? "0"
  const weekdayStr = parts.find((p) => p.type === "weekday")?.value ?? "Sun"

  // `hour: "numeric"` with `hour12: false` returns 0-23, but some
  // engines return "24" for midnight — normalize to 0.
  let hour = Number.parseInt(hourStr, 10)
  if (!Number.isFinite(hour)) hour = 0
  if (hour === 24) hour = 0

  let minute = Number.parseInt(minuteStr, 10)
  if (!Number.isFinite(minute)) minute = 0

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  }
  const weekday = weekdayMap[weekdayStr] ?? 0

  return { hour, minute, weekday }
}

/**
 * True when the current instant is at the given hour (0-23) AND the
 * given weekday (0=Sun ... 6=Sat) in America/New_York.
 *
 * Use to guard a cron route that's scheduled twice (once for EDT, once
 * for EST) so it only runs on the invocation whose UTC mapping lands on
 * the desired Eastern wall-clock hour.
 */
export function isEasternHourAndWeekday(
  targetHour: number,
  targetWeekday: number,
  now: Date = new Date(),
): boolean {
  const { hour, weekday } = nowInEastern(now)
  return hour === targetHour && weekday === targetWeekday
}

/**
 * Same DST-twin pattern as `isEasternHourAndWeekday`, but matches an
 * exact wall-clock hour AND minute (e.g. 11:45 AM) instead of just the
 * hour. Use this when a cron needs to land close to another cron (e.g.
 * PREPARE running 15 minutes before the noon SEND) and an hour-only
 * guard would be too coarse.
 */
export function isEasternTimeAndWeekday(
  targetHour: number,
  targetMinute: number,
  targetWeekday: number,
  now: Date = new Date(),
): boolean {
  const { hour, minute, weekday } = nowInEastern(now)
  return hour === targetHour && minute === targetMinute && weekday === targetWeekday
}

/**
 * Current date in America/New_York as "YYYY-MM-DD" — matches the format
 * `week_date` is stored in (a Postgres `date` column, e.g. "2026-08-14").
 * Comparing this against a ballot's `week_date` string tells you whether
 * that week's Friday is today, already past, or still upcoming, without
 * any UTC/local-timezone drift.
 */
export function todayInEasternDateString(now: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  const parts = fmt.formatToParts(now)
  const year = parts.find((p) => p.type === "year")?.value ?? "1970"
  const month = parts.find((p) => p.type === "month")?.value ?? "01"
  const day = parts.find((p) => p.type === "day")?.value ?? "01"
  return `${year}-${month}-${day}`
}

/**
 * True once voting is closed for the given week (a "YYYY-MM-DD" Friday
 * date). A week closes the moment Eastern wall-clock time reaches
 * `cutoffHour:cutoffMinute` ON that week's date, and stays closed for
 * every date after it. Dates before the week's Friday are always still
 * open (voting happens throughout the week leading up to it).
 *
 * Used server-side by the ballot submit/amend route so a vote can never
 * land after the PREPARE cron has already tallied the podium.
 */
export function isVotingClosedForWeek(
  weekDateStr: string,
  cutoffHour: number,
  cutoffMinute: number,
  now: Date = new Date(),
): boolean {
  const todayStr = todayInEasternDateString(now)
  if (weekDateStr > todayStr) return false // Friday hasn't arrived yet — still open
  if (weekDateStr < todayStr) return true // that Friday has fully passed — closed

  // weekDateStr === todayStr: today IS this week's Friday, so it's only
  // closed once we're at/after the cutoff wall-clock time.
  const { hour, minute } = nowInEastern(now)
  if (hour > cutoffHour) return true
  if (hour === cutoffHour && minute >= cutoffMinute) return true
  return false
}
