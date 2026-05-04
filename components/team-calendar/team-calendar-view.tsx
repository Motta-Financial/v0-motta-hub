"use client"

import { useEffect, useMemo, useState } from "react"
import useSWR from "swr"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import {
  ChevronLeft,
  ChevronRight,
  Search,
  Globe,
  Users,
  RefreshCw,
} from "lucide-react"
import { CalendarGrid } from "./calendar-grid"
import { EventDetailDialog } from "./event-detail-dialog"
import { useUser } from "@/contexts/user-context"
import {
  COMMON_TIMEZONES,
  formatInTz,
  partsInTz,
  startOfDayInTz,
} from "@/lib/calendar-tz"
import type { CalendarView, TeamCalendarEvent } from "./types"

const swrFetcher = (url: string) => fetch(url, { cache: "no-store" }).then((r) => r.json())

interface Props {
  /**
   * Default timezone — usually the logged-in user's profile zone, falling
   * back to the browser's resolved zone. The toolbar lets users switch.
   */
  initialTz?: string | null
}

/**
 * Shifts the anchor by ±1 unit appropriate for the current view. We do
 * the math on UTC milliseconds because that's what `Date` gives us; the
 * calendar grid component re-projects into the target tz when rendering.
 */
function shiftAnchor(anchor: Date, view: CalendarView, dir: -1 | 1, tz: string): Date {
  const next = new Date(anchor.getTime())
  if (view === "day" || view === "list") {
    next.setUTCDate(next.getUTCDate() + dir)
  } else if (view === "week") {
    next.setUTCDate(next.getUTCDate() + dir * 7)
  } else {
    // month: rebuild a fresh anchor at the 1st of the next/previous
    // month in the target zone so DST transitions can't drift the day
    // count.
    const p = partsInTz(anchor, tz)
    const guess = new Date(Date.UTC(p.year, p.month - 1 + dir, 1, 12, 0, 0))
    return startOfDayInTz(guess, tz)
  }
  return next
}

/**
 * Compute the [start, end) ISO range to fetch for the active view. List
 * view fetches the same 30-day window as month so the user can scroll
 * upcoming meetings without re-fetching.
 */
function rangeFor(view: CalendarView, anchor: Date): { from: string; to: string } {
  const a = anchor.getTime()
  const day = 24 * 60 * 60 * 1000
  if (view === "day") {
    return { from: new Date(a - 2 * day).toISOString(), to: new Date(a + 3 * day).toISOString() }
  }
  if (view === "week") {
    return { from: new Date(a - 9 * day).toISOString(), to: new Date(a + 10 * day).toISOString() }
  }
  // month + list: pad ±10 days around a 35-day window so the grid's
  // leading/trailing days from neighbouring months render too.
  return { from: new Date(a - 10 * day).toISOString(), to: new Date(a + 45 * day).toISOString() }
}

function headerLabel(view: CalendarView, anchor: Date, tz: string): string {
  if (view === "day") {
    return formatInTz(anchor, tz, {
      weekday: "long", month: "long", day: "numeric", year: "numeric",
    })
  }
  if (view === "week") {
    // "Mar 3 – 9, 2025" style label.
    const a = new Date(anchor.getTime())
    a.setUTCDate(a.getUTCDate() - 3)
    const b = new Date(anchor.getTime())
    b.setUTCDate(b.getUTCDate() + 3)
    const left = formatInTz(a, tz, { month: "short", day: "numeric" })
    const right = formatInTz(b, tz, { month: "short", day: "numeric", year: "numeric" })
    return `${left} – ${right}`
  }
  if (view === "month") {
    return formatInTz(anchor, tz, { month: "long", year: "numeric" })
  }
  return "Upcoming meetings"
}

export function TeamCalendarView({ initialTz }: Props) {
  const { teamMember } = useUser()
  const browserTz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch {
      return "UTC"
    }
  }, [])
  const [tz, setTz] = useState<string>(initialTz || browserTz)
  const [view, setView] = useState<CalendarView>("week")
  const [anchor, setAnchor] = useState<Date>(() => new Date())
  const [search, setSearch] = useState("")
  const [hostFilter, setHostFilter] = useState<Set<string>>(new Set())
  const [selectedEvent, setSelectedEvent] = useState<TeamCalendarEvent | null>(null)

  const { from, to } = useMemo(() => rangeFor(view, anchor), [view, anchor])
  const url = `/api/calendly/team-calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`

  const { data, isLoading, mutate } = useSWR<{ events: TeamCalendarEvent[] }>(url, swrFetcher, {
    keepPreviousData: true,
    revalidateOnFocus: false,
  })

  // Build the host-filter list from whatever events we've loaded.
  // Done at this level (rather than a separate /team-members fetch) so
  // the chip count beside each name reflects the active window.
  const hostsInWindow = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number }>()
    for (const e of data?.events ?? []) {
      // Prefer the linked team_members row; fall back to the
      // calendly_user_name string for events whose host hasn't been
      // matched to a team member yet.
      const id = e.team_member_id ?? null
      const name = e.team_members?.full_name ?? e.calendly_user_name ?? null
      if (!id || !name) continue
      const cur = map.get(id) ?? { id, name, count: 0 }
      cur.count += 1
      map.set(id, cur)
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [data?.events])

  // Search filter runs client-side because the dataset is small (one
  // window's worth of meetings, typically <500). The match covers the
  // event name plus invitee names + any tagged client/work-item names
  // so a partner can find "Smith" regardless of which field carries it.
  const filtered = useMemo(() => {
    const events = data?.events ?? []
    const q = search.trim().toLowerCase()
    if (!q) return events
    return events.filter((e) => {
      if (e.name?.toLowerCase().includes(q)) return true
      if (e.team_members?.full_name?.toLowerCase().includes(q)) return true
      if (e.calendly_user_name?.toLowerCase().includes(q)) return true
      for (const inv of e.calendly_invitees ?? []) {
        if (inv.name?.toLowerCase().includes(q)) return true
        if (inv.email?.toLowerCase().includes(q)) return true
      }
      for (const t of e.calendly_event_clients ?? []) {
        const label =
          t.contact?.full_name ??
          t.organization?.name ??
          t.contact?.primary_email ??
          ""
        if (label.toLowerCase().includes(q)) return true
      }
      for (const t of e.calendly_event_work_items ?? []) {
        if (t.work_item?.title?.toLowerCase().includes(q)) return true
      }
      for (const t of e.calendly_event_services ?? []) {
        if (t.service?.name?.toLowerCase().includes(q)) return true
      }
      return false
    })
  }, [data?.events, search])

  // Reset anchor to "now" when the user switches views so they don't
  // land in March because they were paged forward in week view.
  useEffect(() => {
    setAnchor(new Date())
  }, [view])

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setAnchor(new Date())}>
              Today
            </Button>
            <div className="flex items-center rounded-md border">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-r-none"
                onClick={() => setAnchor((a) => shiftAnchor(a, view, -1, tz))}
                aria-label="Previous"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-l-none"
                onClick={() => setAnchor((a) => shiftAnchor(a, view, 1, tz))}
                aria-label="Next"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <h2 className="text-lg font-semibold tracking-tight">{headerLabel(view, anchor, tz)}</h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Tabs value={view} onValueChange={(v) => setView(v as CalendarView)}>
              <TabsList>
                <TabsTrigger value="day">Day</TabsTrigger>
                <TabsTrigger value="week">Week</TabsTrigger>
                <TabsTrigger value="month">Month</TabsTrigger>
                <TabsTrigger value="list">List</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9"
              onClick={() => mutate()}
              aria-label="Refresh"
            >
              <RefreshCw className={isLoading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search meetings, hosts, invitees, tags…"
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <Select value={tz} onValueChange={setTz}>
            <SelectTrigger className="w-[260px]">
              <Globe className="mr-2 h-4 w-4" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-[360px]">
              <SelectItem value={browserTz}>
                Browser default ({browserTz})
              </SelectItem>
              {COMMON_TIMEZONES.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <Users className="mr-2 h-4 w-4" />
                Hosts
                {hostFilter.size > 0 ? (
                  <Badge variant="secondary" className="ml-2">{hostFilter.size}</Badge>
                ) : null}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-0" align="end">
              <div className="border-b p-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    Filter by host
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => setHostFilter(new Set())}
                    disabled={hostFilter.size === 0}
                  >
                    Clear
                  </Button>
                </div>
              </div>
              <div className="max-h-72 overflow-auto p-2">
                {hostsInWindow.length === 0 ? (
                  <p className="px-2 py-3 text-xs text-muted-foreground">
                    No hosts in this window.
                  </p>
                ) : (
                  hostsInWindow.map((h) => {
                    const checked = hostFilter.has(h.id)
                    return (
                      <label
                        key={h.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => {
                            setHostFilter((prev) => {
                              const next = new Set(prev)
                              if (v) next.add(h.id)
                              else next.delete(h.id)
                              return next
                            })
                          }}
                        />
                        <span className="flex-1 truncate">{h.name}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {h.count}
                        </span>
                      </label>
                    )
                  })
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </Card>

      {isLoading && !data ? (
        <Skeleton className="h-[680px] w-full rounded-lg" />
      ) : (
        <CalendarGrid
          view={view}
          anchor={anchor}
          tz={tz}
          events={filtered}
          hostFilter={hostFilter.size > 0 ? hostFilter : null}
          onSelectEvent={setSelectedEvent}
        />
      )}

      <EventDetailDialog
        event={selectedEvent}
        timeZone={tz}
        open={!!selectedEvent}
        onOpenChange={(open) => {
          if (!open) setSelectedEvent(null)
        }}
        currentUser={{
          id: teamMember?.id ?? null,
          fullName: teamMember?.full_name ?? null,
          avatarUrl: teamMember?.avatar_url ?? null,
        }}
        onMutated={() => mutate()}
      />
    </div>
  )
}
