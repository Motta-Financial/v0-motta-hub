"use client"

import { useMemo } from "react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
  formatInTz,
  getTzOffsetMinutes,
  partsInTz,
  startOfDayInTz,
} from "@/lib/calendar-tz"
import { Users, MessageSquare, Tag } from "lucide-react"
import type { TeamCalendarEvent, CalendarView } from "./types"

/**
 * Calendar grid renderer for the Team Calendar.
 *
 * Pure presentational layer: it does no fetching, no timezone conversion
 * via the browser's local zone, and no clever event clustering. The
 * caller passes in a list of events plus the active view, anchor date,
 * and target timezone, and the grid renders accordingly. All time
 * arithmetic is delegated to `lib/calendar-tz`, which works off
 * `Intl.DateTimeFormat`'s `formatToParts` so we never have to ship
 * date-fns-tz or moment.
 *
 * Design notes:
 *  - The hour-by-hour day & week views render a fixed 6am-9pm window.
 *    Out-of-window events still render at the edges so they're never
 *    invisible; their position is clamped to the visible band.
 *  - The month view is a fixed 6-row grid (so it doesn't reflow when a
 *    month spans 5 vs 6 weeks) with up to three chips per cell. The
 *    "+N more" affordance routes to onSelectEvent for the cell so the
 *    user can drill down into a busy day.
 */

interface Props {
  view: CalendarView
  /** Anchor date used to compute the visible window (always at midnight in `tz`). */
  anchor: Date
  /** IANA timezone name. Drives every "what hour is it?" decision. */
  tz: string
  /** Events sorted by start_time ascending. */
  events: TeamCalendarEvent[]
  /** Optional: only render events whose host team_member_id is in this set. */
  hostFilter?: Set<string> | null
  onSelectEvent: (event: TeamCalendarEvent) => void
}

const DAY_START_HOUR = 6
const DAY_END_HOUR = 21
const HOUR_HEIGHT = 56 // px per hour in day/week views
const VISIBLE_HOURS = DAY_END_HOUR - DAY_START_HOUR

/**
 * Map a wall-clock minute-offset within a day to a vertical pixel
 * position inside the hour band. Clamps so events that fall before/after
 * the visible window still appear at the edges.
 */
function minuteToY(minuteOfDay: number): number {
  const startMin = DAY_START_HOUR * 60
  const endMin = DAY_END_HOUR * 60
  const clamped = Math.max(startMin, Math.min(endMin, minuteOfDay))
  return ((clamped - startMin) / 60) * HOUR_HEIGHT
}

/**
 * Convert an event's start/end into [topPx, heightPx] within the day
 * column for the given target timezone. The minimum visual height is
 * 24px so a 5-minute meeting is still clickable.
 */
function eventGeometry(event: TeamCalendarEvent, tz: string): { top: number; height: number } {
  const start = new Date(event.start_time)
  const end = new Date(event.end_time)
  const sParts = partsInTz(start, tz)
  const eParts = partsInTz(end, tz)
  const sMin = sParts.hour * 60 + sParts.minute
  const eMin = eParts.hour * 60 + eParts.minute
  // If the event crosses midnight in the target zone, end-of-day wins
  // for the start column; cross-day rendering is intentionally not
  // supported in this minimal grid.
  const top = minuteToY(sMin)
  const bottom = minuteToY(eMin <= sMin ? sMin + 30 : eMin)
  return { top, height: Math.max(24, bottom - top) }
}

/** Same calendar day in `tz` (compares year, month, date components). */
function isSameDayInTz(a: Date, b: Date, tz: string): boolean {
  const ap = partsInTz(a, tz)
  const bp = partsInTz(b, tz)
  return ap.year === bp.year && ap.month === bp.month && ap.day === bp.day
}

/** Add `days` to `date` while staying in the target timezone. */
function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime())
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

/** Sunday-anchored start of the calendar week containing `date` in `tz`. */
function startOfWeekInTz(date: Date, tz: string): Date {
  const dayMid = startOfDayInTz(date, tz)
  // Compute the day-of-week in tz by formatting the midnight instant.
  const wdName = formatInTz(dayMid, tz, { weekday: "short" })
  const map: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  }
  const wd = map[wdName] ?? 0
  return addDays(dayMid, -wd)
}

function startOfMonthInTz(date: Date, tz: string): Date {
  const p = partsInTz(date, tz)
  // Build a UTC midnight that, when shifted back into the zone, lands
  // on the 1st-of-month at 00:00. We use the fact that for any zone,
  // the offset at the 1st is well-defined modulo a few hours we'll
  // smooth over by re-anchoring with startOfDayInTz.
  const guess = new Date(Date.UTC(p.year, p.month - 1, 1, 12, 0, 0))
  return startOfDayInTz(guess, tz)
}

// ─────────────────────────────────────────────────────────────────────
// Event chip — shared across all views
// ─────────────────────────────────────────────────────────────────────

function EventChip({
  event,
  tz,
  variant,
  onClick,
}: {
  event: TeamCalendarEvent
  tz: string
  variant: "stacked" | "month" | "list"
  onClick: () => void
}) {
  const start = new Date(event.start_time)
  const inviteeCount = event.calendly_invitees?.length ?? 0
  const tagCount =
    (event.calendly_event_clients?.length ?? 0) +
    (event.calendly_event_work_items?.length ?? 0) +
    (event.calendly_event_services?.length ?? 0)
  const commentCount = event.commentCount ?? 0
  const hostName = event.team_members?.full_name ?? event.calendly_user_name ?? null

  // The host's team_member_id seeds a deterministic color so each
  // teammate's events read as a coherent column at a glance. We tweak
  // the saturation/lightness pair by variant so chips stay legible on
  // both the dark hour-grid background and the light month grid.
  const hue = useMemo(() => {
    const seed = event.team_member_id ?? event.id
    let h = 0
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360
    return h
  }, [event.team_member_id, event.id])

  if (variant === "stacked") {
    return (
      <button
        type="button"
        onClick={onClick}
        className="group absolute left-1 right-1 overflow-hidden rounded-md border border-l-4 px-2 py-1 text-left text-xs shadow-sm transition hover:shadow-md"
        style={{
          background: `hsl(${hue} 88% 96%)`,
          borderColor: `hsl(${hue} 60% 80%)`,
          borderLeftColor: `hsl(${hue} 70% 50%)`,
        }}
        title={event.name}
      >
        <div className="font-medium leading-tight text-stone-900 line-clamp-2">{event.name}</div>
        <div className="mt-0.5 text-[10px] text-stone-600">
          {formatInTz(start, tz, { hour: "numeric", minute: "2-digit" })}
        </div>
        {hostName ? (
          <div className="mt-0.5 truncate text-[10px] text-stone-500">{hostName}</div>
        ) : null}
        <div className="mt-1 flex items-center gap-2 text-[10px] text-stone-500">
          {inviteeCount > 0 ? (
            <span className="inline-flex items-center gap-0.5">
              <Users className="h-2.5 w-2.5" />
              {inviteeCount}
            </span>
          ) : null}
          {tagCount > 0 ? (
            <span className="inline-flex items-center gap-0.5">
              <Tag className="h-2.5 w-2.5" />
              {tagCount}
            </span>
          ) : null}
          {commentCount > 0 ? (
            <span className="inline-flex items-center gap-0.5">
              <MessageSquare className="h-2.5 w-2.5" />
              {commentCount}
            </span>
          ) : null}
        </div>
      </button>
    )
  }

  if (variant === "month") {
    return (
      <button
        type="button"
        onClick={onClick}
        className="group flex w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-left text-[11px] hover:opacity-90"
        style={{ background: `hsl(${hue} 80% 92%)`, color: `hsl(${hue} 60% 25%)` }}
      >
        <span className="font-semibold tabular-nums">
          {formatInTz(start, tz, { hour: "numeric", minute: "2-digit" })}
        </span>
        <span className="truncate">{event.name}</span>
      </button>
    )
  }

  // List view
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 rounded-md border bg-card px-3 py-2 text-left transition hover:border-stone-300 hover:shadow-sm"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-semibold text-stone-700 tabular-nums">
            {formatInTz(start, tz, { hour: "numeric", minute: "2-digit" })}
          </span>
          <span className="truncate text-sm font-medium">{event.name}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
          {hostName ? <span>{hostName}</span> : null}
          {inviteeCount > 0 ? (
            <span className="inline-flex items-center gap-1">
              <Users className="h-3 w-3" />
              {inviteeCount}
            </span>
          ) : null}
          {tagCount > 0 ? (
            <Badge variant="secondary" className="text-[10px]">
              {tagCount} tag{tagCount === 1 ? "" : "s"}
            </Badge>
          ) : null}
          {commentCount > 0 ? (
            <Badge variant="outline" className="text-[10px]">
              {commentCount} note{commentCount === 1 ? "" : "s"}
            </Badge>
          ) : null}
        </div>
      </div>
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Day / Week views — share the same hour-band machinery
// ─────────────────────────────────────────────────────────────────────

function HourGutter({ tz }: { tz: string }) {
  return (
    <div className="w-14 shrink-0 select-none border-r bg-muted/30">
      <div className="h-10 border-b" />
      {Array.from({ length: VISIBLE_HOURS }, (_, i) => {
        const hour = DAY_START_HOUR + i
        // Build a tagged Date for "today at this hour in tz" purely so
        // we can format it; the date portion doesn't matter.
        const ref = new Date(Date.UTC(2024, 0, 1, hour, 0, 0))
        // We render UTC label here but to the user it's just "11 AM"
        // since we passed nothing tz-specific. Rendering the literal
        // hour avoids a DST-edge bug entirely for the gutter.
        const label = ref.toLocaleString("en-US", { hour: "numeric", timeZone: "UTC" })
        return (
          <div
            key={hour}
            className="relative pr-2 text-right text-[10px] text-muted-foreground"
            style={{ height: HOUR_HEIGHT }}
          >
            <span className="absolute -top-2 right-2 bg-muted/30 px-1">{label}</span>
          </div>
        )
      })}
    </div>
  )
}

function DayColumn({
  day,
  tz,
  events,
  onSelectEvent,
  showHeader,
}: {
  day: Date
  tz: string
  events: TeamCalendarEvent[]
  onSelectEvent: (e: TeamCalendarEvent) => void
  showHeader: boolean
}) {
  const dayEvents = useMemo(
    () => events.filter((e) => isSameDayInTz(new Date(e.start_time), day, tz)),
    [events, day, tz],
  )

  // Greedy column-packing: walk events sorted by start, place each in
  // the first column whose latest end is <= this event's start. This
  // keeps overlapping meetings side-by-side instead of stacked. We cap
  // the column count at 4 to keep chips wide enough to read; events
  // beyond that get clamped into the last column.
  const placed = useMemo(() => {
    const cols: { end: number }[] = []
    return dayEvents.map((event) => {
      const start = new Date(event.start_time).getTime()
      const end = new Date(event.end_time).getTime()
      let col = cols.findIndex((c) => c.end <= start)
      if (col === -1) {
        col = Math.min(cols.length, 3)
        cols[col] = { end }
      } else {
        cols[col] = { end }
      }
      return { event, col }
    })
  }, [dayEvents])

  const colCount = Math.max(1, ...placed.map((p) => p.col + 1))
  const dayLabel = formatInTz(day, tz, { weekday: "short", month: "short", day: "numeric" })
  const isToday = isSameDayInTz(new Date(), day, tz)

  return (
    <div className="flex min-w-0 flex-1 flex-col border-r last:border-r-0">
      {showHeader ? (
        <div
          className={cn(
            "flex h-10 items-center justify-center border-b text-xs font-medium",
            isToday ? "bg-emerald-50 text-emerald-900" : "bg-muted/20 text-stone-700",
          )}
        >
          {dayLabel}
        </div>
      ) : null}
      <div
        className="relative flex-1"
        style={{ height: VISIBLE_HOURS * HOUR_HEIGHT }}
      >
        {/* hour gridlines */}
        {Array.from({ length: VISIBLE_HOURS }, (_, i) => (
          <div
            key={i}
            className="absolute left-0 right-0 border-b border-dashed border-stone-200/60"
            style={{ top: i * HOUR_HEIGHT }}
          />
        ))}
        {placed.map(({ event, col }) => {
          const { top, height } = eventGeometry(event, tz)
          const widthPct = 100 / colCount
          return (
            <div
              key={event.id}
              className="absolute"
              style={{
                top,
                height,
                left: `calc(${col * widthPct}% + 2px)`,
                width: `calc(${widthPct}% - 4px)`,
              }}
            >
              <EventChip event={event} tz={tz} variant="stacked" onClick={() => onSelectEvent(event)} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DayView({ anchor, tz, events, onSelectEvent }: Omit<Props, "view" | "hostFilter">) {
  return (
    <div className="flex h-[680px] overflow-hidden rounded-lg border bg-card">
      <HourGutter tz={tz} />
      <DayColumn day={anchor} tz={tz} events={events} onSelectEvent={onSelectEvent} showHeader />
    </div>
  )
}

function WeekView({ anchor, tz, events, onSelectEvent }: Omit<Props, "view" | "hostFilter">) {
  const weekStart = useMemo(() => startOfWeekInTz(anchor, tz), [anchor, tz])
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])
  return (
    <div className="flex h-[680px] overflow-hidden rounded-lg border bg-card">
      <HourGutter tz={tz} />
      {days.map((day) => (
        <DayColumn
          key={day.toISOString()}
          day={day}
          tz={tz}
          events={events}
          onSelectEvent={onSelectEvent}
          showHeader
        />
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Month view — 6-row fixed grid with chip overflow
// ─────────────────────────────────────────────────────────────────────

function MonthView({ anchor, tz, events, onSelectEvent }: Omit<Props, "view" | "hostFilter">) {
  const monthStart = useMemo(() => startOfMonthInTz(anchor, tz), [anchor, tz])
  const monthLabel = formatInTz(anchor, tz, { month: "long", year: "numeric" })
  const gridStart = useMemo(() => startOfWeekInTz(monthStart, tz), [monthStart, tz])
  const cells = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)), [gridStart])
  const today = new Date()
  const anchorMonth = partsInTz(monthStart, tz).month

  const eventsByDay = useMemo(() => {
    const map = new Map<string, TeamCalendarEvent[]>()
    for (const e of events) {
      const key = formatInTz(new Date(e.start_time), tz, {
        year: "numeric", month: "2-digit", day: "2-digit",
      })
      const list = map.get(key) ?? []
      list.push(e)
      map.set(key, list)
    }
    return map
  }, [events, tz])

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="grid grid-cols-7 border-b bg-muted/20 text-xs font-medium text-stone-700">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="px-2 py-2 text-center">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 grid-rows-6">
        {cells.map((day) => {
          const partsKey = formatInTz(day, tz, {
            year: "numeric", month: "2-digit", day: "2-digit",
          })
          const dayEvents = eventsByDay.get(partsKey) ?? []
          const inMonth = partsInTz(day, tz).month === anchorMonth
          const isToday = isSameDayInTz(today, day, tz)
          const dayNum = formatInTz(day, tz, { day: "numeric" })
          const visible = dayEvents.slice(0, 3)
          const overflow = dayEvents.length - visible.length
          return (
            <div
              key={partsKey}
              className={cn(
                "min-h-[112px] border-b border-r p-1.5 last-of-type:border-r-0",
                inMonth ? "bg-card" : "bg-muted/30",
              )}
            >
              <div className="mb-1 flex items-center justify-between">
                <span
                  className={cn(
                    "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] tabular-nums",
                    isToday ? "bg-emerald-600 text-white" : inMonth ? "text-stone-700" : "text-stone-400",
                  )}
                >
                  {dayNum}
                </span>
                {dayEvents.length > 0 && !isToday ? (
                  <span className="text-[10px] text-muted-foreground">{dayEvents.length}</span>
                ) : null}
              </div>
              <div className="space-y-0.5">
                {visible.map((e) => (
                  <EventChip
                    key={e.id}
                    event={e}
                    tz={tz}
                    variant="month"
                    onClick={() => onSelectEvent(e)}
                  />
                ))}
                {overflow > 0 ? (
                  <button
                    type="button"
                    onClick={() => onSelectEvent(dayEvents[3])}
                    className="text-[10px] font-medium text-stone-500 hover:text-stone-800"
                  >
                    +{overflow} more
                  </button>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
      <div className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">{monthLabel}</div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// List view
// ─────────────────────────────────────────────────────────────────────

function ListView({ anchor, tz, events, onSelectEvent }: Omit<Props, "view" | "hostFilter">) {
  const grouped = useMemo(() => {
    const buckets = new Map<string, { day: Date; events: TeamCalendarEvent[] }>()
    for (const e of events) {
      const start = new Date(e.start_time)
      const key = formatInTz(start, tz, { year: "numeric", month: "2-digit", day: "2-digit" })
      let bucket = buckets.get(key)
      if (!bucket) {
        bucket = { day: start, events: [] }
        buckets.set(key, bucket)
      }
      bucket.events.push(e)
    }
    return Array.from(buckets.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [events, tz])

  // Suppress unused warning; anchor isn't used in list view (we render
  // every event in the fetched window, sorted chronologically).
  void anchor

  if (grouped.length === 0) {
    return (
      <div className="rounded-lg border bg-card py-16 text-center text-sm text-muted-foreground">
        No meetings in this window.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {grouped.map(([key, { day, events: dayEvents }]) => (
        <div key={key}>
          <h3 className="mb-2 text-sm font-semibold text-stone-700">
            {formatInTz(day, tz, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
          </h3>
          <div className="space-y-1">
            {dayEvents.map((e) => (
              <EventChip key={e.id} event={e} tz={tz} variant="list" onClick={() => onSelectEvent(e)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────

export function CalendarGrid({ view, anchor, tz, events, hostFilter, onSelectEvent }: Props) {
  const filtered = useMemo(() => {
    if (!hostFilter || hostFilter.size === 0) return events
    return events.filter((e) => e.team_member_id && hostFilter.has(e.team_member_id))
  }, [events, hostFilter])

  if (view === "day") return <DayView anchor={anchor} tz={tz} events={filtered} onSelectEvent={onSelectEvent} />
  if (view === "week") return <WeekView anchor={anchor} tz={tz} events={filtered} onSelectEvent={onSelectEvent} />
  if (view === "month") return <MonthView anchor={anchor} tz={tz} events={filtered} onSelectEvent={onSelectEvent} />
  return <ListView anchor={anchor} tz={tz} events={filtered} onSelectEvent={onSelectEvent} />
}
