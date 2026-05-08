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
  /**
   * Pre-resolved firm-wide color for each event_type_name. When present,
   * the chip uses this hex; when absent (e.g. a brand-new type that
   * hasn't reached our color endpoint yet) the chip falls back to a
   * deterministic name-hash hue so it's still distinguishable.
   */
  typeColorMap?: Map<string, string> | null
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

/**
 * Parse `#rrggbb` (or `#rrggbbaa`, alpha discarded) into 0-255 channels.
 * Any malformed input falls back to slate-500 so we never throw at render.
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#([0-9a-f]{6})/i.exec(hex)
  if (!m) return { r: 100, g: 116, b: 139 } // slate-500
  const v = m[1]
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  }
}

/**
 * Resolve the chip palette from a single base hex. We derive everything
 * the chip needs in one pass:
 *  - `bgSoft`:   pale tint behind the chip text (background)
 *  - `border`:   muted edge that matches the bg
 *  - `accent`:   saturated line on the left edge — the visual "type" cue
 *  - `text`:     darkened brand color used for chip text on the soft bg
 *
 * We use `color-mix(in srgb, …)` so the math runs in the browser and
 * automatically adapts to whatever hex the user picks (unlike fixed
 * Tailwind palettes). Fallback is the same color across the board for
 * environments without color-mix support.
 */
function chipPalette(hex: string): {
  bgSoft: string
  border: string
  accent: string
  text: string
} {
  // color-mix was Baseline 2023+ so it's safe to assume; the worst case
  // in an old browser is the chip uses the raw hex which is still legible.
  return {
    bgSoft: `color-mix(in srgb, ${hex} 14%, white)`,
    border: `color-mix(in srgb, ${hex} 38%, white)`,
    accent: hex,
    text: `color-mix(in srgb, ${hex} 75%, black)`,
  }
}

function EventChip({
  event,
  tz,
  variant,
  typeColorMap,
  onClick,
}: {
  event: TeamCalendarEvent
  tz: string
  variant: "stacked" | "month" | "list"
  typeColorMap?: Map<string, string> | null
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

  // The chip color is keyed off `event_type_name` so meetings of the
  // same type read as a single visual category across the team. The
  // map is firm-wide (overrides → Calendly default → server-provided
  // hex). For events without a type entry yet (rare — newly synced
  // event types), we fall back to a deterministic name-hash hue so
  // they're still distinguishable from neighbors.
  const baseHex = useMemo(() => {
    const name = event.event_type_name
    if (name && typeColorMap?.has(name)) return typeColorMap.get(name)!
    // Hash either the event_type_name (preferred — same color for same
    // type across users) or fall back to event id. Convert to a saturated
    // HSL → hex so the color-mix calculations downstream stay consistent.
    const seed = name || event.id
    let h = 0
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360
    // Convert HSL(h, 65%, 50%) to hex via canvas-free arithmetic.
    const s = 0.65,
      l = 0.5
    const c = (1 - Math.abs(2 * l - 1)) * s
    const hp = h / 60
    const x = c * (1 - Math.abs((hp % 2) - 1))
    let r = 0,
      g = 0,
      b = 0
    if (hp < 1) [r, g, b] = [c, x, 0]
    else if (hp < 2) [r, g, b] = [x, c, 0]
    else if (hp < 3) [r, g, b] = [0, c, x]
    else if (hp < 4) [r, g, b] = [0, x, c]
    else if (hp < 5) [r, g, b] = [x, 0, c]
    else [r, g, b] = [c, 0, x]
    const m = l - c / 2
    const to2 = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, "0")
    return `#${to2(r)}${to2(g)}${to2(b)}`
  }, [event.event_type_name, event.id, typeColorMap])

  const palette = useMemo(() => chipPalette(baseHex), [baseHex])
  // Suppress unused-import lint when we eventually drop hexToRgb if not
  // referenced — keep it accessible in case future variants need raw rgb.
  void hexToRgb

  if (variant === "stacked") {
    return (
      <button
        type="button"
        onClick={onClick}
        className="group absolute left-1 right-1 overflow-hidden rounded-md border border-l-4 px-2 py-1 text-left text-xs shadow-sm transition hover:shadow-md"
        style={{
          background: palette.bgSoft,
          borderColor: palette.border,
          borderLeftColor: palette.accent,
        }}
        title={event.event_type_name ? `${event.name} · ${event.event_type_name}` : event.name}
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
        style={{ background: palette.bgSoft, color: palette.text }}
        title={event.event_type_name ? `${event.name} · ${event.event_type_name}` : event.name}
      >
        <span className="font-semibold tabular-nums">
          {formatInTz(start, tz, { hour: "numeric", minute: "2-digit" })}
        </span>
        <span className="truncate">{event.name}</span>
      </button>
    )
  }

  // List view — keep the neutral card surface, but accent the leading
  // edge with the type color so the eye still gets the categorical cue.
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 rounded-md border-l-4 border bg-card px-3 py-2 text-left transition hover:border-stone-300 hover:shadow-sm"
      style={{ borderLeftColor: palette.accent }}
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
          {event.event_type_name ? (
            <span className="truncate">{event.event_type_name}</span>
          ) : null}
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
  typeColorMap,
  onSelectEvent,
  showHeader,
}: {
  day: Date
  tz: string
  events: TeamCalendarEvent[]
  typeColorMap?: Map<string, string> | null
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
              <EventChip
                event={event}
                tz={tz}
                variant="stacked"
                typeColorMap={typeColorMap}
                onClick={() => onSelectEvent(event)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DayView({
  anchor,
  tz,
  events,
  typeColorMap,
  onSelectEvent,
}: Omit<Props, "view" | "hostFilter">) {
  return (
    <div className="flex h-[680px] overflow-hidden rounded-lg border bg-card">
      <HourGutter tz={tz} />
      <DayColumn
        day={anchor}
        tz={tz}
        events={events}
        typeColorMap={typeColorMap}
        onSelectEvent={onSelectEvent}
        showHeader
      />
    </div>
  )
}

function WeekView({
  anchor,
  tz,
  events,
  typeColorMap,
  onSelectEvent,
}: Omit<Props, "view" | "hostFilter">) {
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
          typeColorMap={typeColorMap}
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

function MonthView({
  anchor,
  tz,
  events,
  typeColorMap,
  onSelectEvent,
}: Omit<Props, "view" | "hostFilter">) {
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
                    typeColorMap={typeColorMap}
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

function ListView({
  anchor,
  tz,
  events,
  typeColorMap,
  onSelectEvent,
}: Omit<Props, "view" | "hostFilter">) {
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
              <EventChip
                key={e.id}
                event={e}
                tz={tz}
                variant="list"
                typeColorMap={typeColorMap}
                onClick={() => onSelectEvent(e)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────

export function CalendarGrid({
  view,
  anchor,
  tz,
  events,
  hostFilter,
  typeColorMap,
  onSelectEvent,
}: Props) {
  const filtered = useMemo(() => {
    if (!hostFilter || hostFilter.size === 0) return events
    return events.filter((e) => e.team_member_id && hostFilter.has(e.team_member_id))
  }, [events, hostFilter])

  const sharedProps = { tz, events: filtered, typeColorMap, onSelectEvent }
  if (view === "day") return <DayView anchor={anchor} {...sharedProps} />
  if (view === "week") return <WeekView anchor={anchor} {...sharedProps} />
  if (view === "month") return <MonthView anchor={anchor} {...sharedProps} />
  return <ListView anchor={anchor} {...sharedProps} />
}
