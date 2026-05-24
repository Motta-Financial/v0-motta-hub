"use client"

import type React from "react"
import Link from "next/link"
import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Trophy, Flame, Target, Users, Zap, Calendar, Filter, X, Send } from "lucide-react"
import { TommyLeaderboard } from "./tommy-leaderboard"
import { TommyYTDLeaderboard } from "./tommy-ytd-leaderboard"
import { TommyRecentBallots } from "./tommy-recent-ballots"

interface Week {
  id: string
  week_date: string
  week_name: string
  is_active: boolean
}

interface TeamMember {
  id: string
  full_name: string
  first_name: string
  last_name: string
  is_active: boolean
}

interface Filters {
  year: string
  weekIds: string[]
  teamMemberId: string
}

export function TommyAwardsPage() {
  const [weeks, setWeeks] = useState<Week[]>([])
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [filters, setFilters] = useState<Filters>({
    year: new Date().getFullYear().toString(),
    weekIds: [],
    teamMemberId: "",
  })
  const [filteredWeeks, setFilteredWeeks] = useState<Week[]>([])
  const [currentWeekId, setCurrentWeekId] = useState<string | null>(null)
  // The week ID auto-selected on initial load (current week if it has ballots,
  // otherwise the most recent week with ballots). Used as the "default" baseline
  // for clearFilters() and hasActiveFilters detection.
  const [defaultWeekId, setDefaultWeekId] = useState<string | null>(null)

  useEffect(() => {
    fetchFilterData()
  }, [])

  useEffect(() => {
    // Filter weeks by selected year, sort with current week first then most recent
    if (filters.year && filters.year !== "all") {
      const yearWeeks = weeks.filter((week) => week.week_date.startsWith(filters.year))
      const sorted = sortWeeksWithCurrentFirst(yearWeeks)
      setFilteredWeeks(sorted)
      // Reset week selections if none are in filtered year
      if (filters.weekIds.length > 0) {
        const validIds = filters.weekIds.filter((id) => yearWeeks.find((w) => w.id === id))
        if (validIds.length !== filters.weekIds.length) {
          setFilters((prev) => ({ ...prev, weekIds: validIds }))
        }
      }
    } else {
      setFilteredWeeks(sortWeeksWithCurrentFirst(weeks))
    }
  }, [filters.year, weeks, currentWeekId])

  const getCurrentWeekDate = () => {
    const today = new Date()
    const day = today.getDay()
    const diff = day <= 5 ? 5 - day : 5 - day + 7
    const friday = new Date(today)
    friday.setDate(today.getDate() + diff)
    // Format in local time to avoid UTC shift bugs (Friday → Saturday)
    const yyyy = friday.getFullYear()
    const mm = String(friday.getMonth() + 1).padStart(2, "0")
    const dd = String(friday.getDate()).padStart(2, "0")
    return `${yyyy}-${mm}-${dd}`
  }

  // Defensive: dedupe weeks by week_name in case the database has any duplicates
  const dedupeWeeks = (list: Week[]): Week[] => {
    const groups: Record<string, Week[]> = {}
    for (const w of list) {
      if (!groups[w.week_name]) groups[w.week_name] = []
      groups[w.week_name].push(w)
    }
    const result: Week[] = []
    for (const items of Object.values(groups)) {
      if (items.length === 1) {
        result.push(items[0])
        continue
      }
      // Prefer Friday-dated entry
      const friday = items.find((it) => {
        const [y, m, d] = it.week_date.split("-").map(Number)
        return new Date(y, m - 1, d).getDay() === 5
      })
      const active = items.find((it) => it.is_active)
      result.push(friday || active || items[0])
    }
    return result
  }

  const sortWeeksWithCurrentFirst = (weeksList: Week[]) => {
    const currentFriday = getCurrentWeekDate()
    return [...weeksList].sort((a, b) => {
      // Current week always first
      if (a.week_date === currentFriday) return -1
      if (b.week_date === currentFriday) return 1
      // Then sort by date descending (most recent first)
      return b.week_date.localeCompare(a.week_date)
    })
  }

  const fetchFilterData = async () => {
    try {
      // Fetch weeks and most recent ballot in parallel
      const [weeksRes, latestBallotRes, membersRes] = await Promise.all([
        fetch("/api/tommy-awards?type=weeks"),
        fetch("/api/tommy-awards?type=latest_ballot_week"),
        fetch("/api/tommy-awards?type=team_members"),
      ])

      const weeksData = await weeksRes.json()
      const fetchedWeeks: Week[] = dedupeWeeks(weeksData.weeks || [])
      setWeeks(fetchedWeeks)

      // Detect current week (for "Current" badge)
      const currentFriday = getCurrentWeekDate()
      const currentWeek = fetchedWeeks.find((w) => w.week_date === currentFriday)
      if (currentWeek) {
        setCurrentWeekId(currentWeek.id)
      }

      // Default the week filter to the most recent week that actually has ballots.
      // This prevents the Leaderboard & Ballots widgets from being empty when the
      // current week is brand new and has no submissions yet.
      const latestBallotData = await latestBallotRes.json()
      const latestWeekId: string | null = latestBallotData.week_id || null

      if (latestWeekId && fetchedWeeks.some((w) => w.id === latestWeekId)) {
        setDefaultWeekId(latestWeekId)
        setFilters((prev) => ({ ...prev, weekIds: [latestWeekId] }))
      } else if (currentWeek) {
        // Fall back to current week if no ballots exist anywhere yet
        setDefaultWeekId(currentWeek.id)
        setFilters((prev) => ({ ...prev, weekIds: [currentWeek.id] }))
      }

      // Team members
      const membersData = await membersRes.json()
      setTeamMembers(membersData.team_members || [])
    } catch (error) {
      console.error("Error fetching filter data:", error)
    }
  }

  // The Weekly Leaderboard is anchored to a single week — multi-week
  // unions made the recap panel ambiguous (which week's summary?) and
  // muddled the standings narrative. Selecting a week now REPLACES
  // the current selection rather than toggling it on top.
  const selectWeek = (weekId: string) => {
    setFilters((prev) => ({
      ...prev,
      weekIds: prev.weekIds[0] === weekId ? [] : [weekId],
    }))
  }

  const clearFilters = () => {
    setFilters({
      year: new Date().getFullYear().toString(),
      weekIds: defaultWeekId ? [defaultWeekId] : [],
      teamMemberId: "",
    })
  }

  // Active filter detection: any deviation from the auto-selected default
  const isDefaultWeekSelection =
    defaultWeekId !== null &&
    filters.weekIds.length === 1 &&
    filters.weekIds[0] === defaultWeekId
  const hasActiveFilters =
    !isDefaultWeekSelection ||
    !!filters.teamMemberId ||
    filters.year !== new Date().getFullYear().toString()

  // Get unique years from weeks
  const years = [...new Set(weeks.map((w) => w.week_date.substring(0, 4)))].sort((a, b) => b.localeCompare(a))

  return (
    <div className="space-y-8">
      {/* Brand-themed hero — Motta Alliance comic-book style. Dark midnight
          olive base with the signature comic-green accent and halftone
          texture, matching the Alliance gallery aesthetic. */}
      <div
        className="relative overflow-hidden rounded-2xl border-2"
        style={{
          backgroundColor: "#0F140C",
          borderColor: "rgba(168,197,102,0.30)",
          boxShadow:
            "0 0 0 1px rgba(168,197,102,0.08) inset, 0 30px 80px -40px rgba(0,0,0,0.75)",
        }}
      >
        {/* Radial gradient spotlights — comic-green at top, amber at bottom */}
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(circle at 90% 0%, rgba(168,197,102,0.18), transparent 55%)," +
              "radial-gradient(circle at 0% 100%, rgba(230,168,92,0.10), transparent 55%)",
          }}
        />
        {/* Halftone dot pattern — printed-comic texture */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              "radial-gradient(circle at center, rgba(244,239,232,0.8) 1px, transparent 1.5px)",
            backgroundSize: "8px 8px",
          }}
        />

        <div className="relative z-10 p-8 lg:p-10">
          <div className="flex flex-col lg:flex-row items-start gap-8">
            {/* Trophy Icon — comic-book badge style */}
            <div className="relative flex-shrink-0">
              <div
                className="w-24 h-24 lg:w-28 lg:h-28 rounded-2xl flex items-center justify-center shadow-2xl border-2"
                style={{
                  backgroundColor: "rgba(168,197,102,0.15)",
                  borderColor: "rgba(168,197,102,0.40)",
                  boxShadow: "0 0 40px rgba(168,197,102,0.20)",
                }}
              >
                <Trophy className="h-12 w-12 lg:h-14 lg:w-14" style={{ color: "#A8C566" }} />
              </div>
            </div>

            {/* Header Content */}
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-3 flex-wrap">
                <span
                  className="inline-flex items-center gap-1.5 rounded-sm border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em]"
                  style={{
                    borderColor: "rgba(168,197,102,0.5)",
                    color: "#A8C566",
                    backgroundColor: "rgba(168,197,102,0.08)",
                  }}
                >
                  Weekly Peer Recognition
                </span>
                <span
                  className="inline-flex items-center rounded-sm border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em]"
                  style={{
                    borderColor: "rgba(230,168,92,0.5)",
                    color: "#E6A85C",
                    backgroundColor: "rgba(230,168,92,0.08)",
                  }}
                >
                  Motta Financial
                </span>
              </div>
              <h1
                className="font-sans text-4xl font-black uppercase italic leading-[0.95] tracking-tight text-balance lg:text-5xl"
                style={{
                  color: "#F4EFE8",
                  textShadow: "0 2px 0 rgba(0,0,0,0.6), 0 0 30px rgba(168,197,102,0.18)",
                }}
              >
                Tommy <span style={{ color: "#A8C566" }}>Awards</span>
              </h1>
              <p
                className="mt-4 text-sm leading-relaxed max-w-3xl text-pretty lg:text-base"
                style={{ color: "#B8B3AA" }}
              >
                A weekly vote among all team members of the firm to vote for who they thought represents Tom Brady the
                best — whether with their contributions from a work standpoint, going the extra mile, client wins, and
                most importantly being a good teammate and representing firm culture.
              </p>

              {/* Primary CTA — comic-book button style */}
              <div className="mt-5 flex flex-wrap gap-3">
                <Button
                  asChild
                  size="lg"
                  className="font-bold uppercase tracking-wider"
                  style={{
                    backgroundColor: "#A8C566",
                    color: "#0F140C",
                  }}
                >
                  <Link href="/tommy-awards/ballot" className="inline-flex items-center gap-2">
                    <Send className="h-4 w-4" />
                    Submit This Week&apos;s Ballot
                  </Link>
                </Button>
              </div>
            </div>
          </div>

          {/* Core Characteristics — comic-book card style */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-8">
            <CharacteristicBadge
              icon={<Flame className="h-5 w-5" />}
              label="Going the Extra Mile"
              description="Above & beyond"
            />
            <CharacteristicBadge
              icon={<Target className="h-5 w-5" />}
              label="Client Wins"
              description="Delivering results"
            />
            <CharacteristicBadge
              icon={<Users className="h-5 w-5" />}
              label="Great Teammate"
              description="Lifting others up"
            />
            <CharacteristicBadge
              icon={<Zap className="h-5 w-5" />}
              label="Firm Culture"
              description="Living our values"
            />
          </div>
        </div>
      </div>

      <Card
        className="border-2"
        style={{
          backgroundColor: "#0F140C",
          borderColor: "rgba(168,197,102,0.25)",
        }}
      >
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className="p-2 rounded-lg"
                style={{ backgroundColor: "rgba(168,197,102,0.15)" }}
              >
                <Filter className="h-5 w-5" style={{ color: "#A8C566" }} />
              </div>
              <div>
                <CardTitle className="text-lg" style={{ color: "#F4EFE8" }}>Filter Results</CardTitle>
                <CardDescription style={{ color: "#B8B3AA" }}>Filter by year, week, or team member</CardDescription>
              </div>
            </div>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                style={{ color: "#B8B3AA" }}
                className="hover:bg-[rgba(168,197,102,0.1)]"
              >
                <X className="h-4 w-4 mr-1" />
                Clear Filters
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Year Filter */}
            <div className="space-y-2">
              <label className="text-sm font-medium" style={{ color: "#F4EFE8" }}>Year</label>
              <Select
                value={filters.year}
                onValueChange={(value) => setFilters((prev) => ({ ...prev, year: value, weekId: "" }))}
              >
                <SelectTrigger
                  style={{
                    backgroundColor: "rgba(168,197,102,0.06)",
                    borderColor: "rgba(168,197,102,0.30)",
                    color: "#F4EFE8",
                  }}
                  className="h-10 hover:bg-[rgba(168,197,102,0.10)]"
                >
                  <SelectValue placeholder="All Years" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Years</SelectItem>
                  {years.map((year) => (
                    <SelectItem key={year} value={year}>
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Week Filter (Multi-Select) */}
            <div className="space-y-2">
              <label className="text-sm font-medium" style={{ color: "#F4EFE8" }}>Week</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-start font-normal h-10 hover:bg-[rgba(168,197,102,0.10)]"
                    style={{
                      backgroundColor: "rgba(168,197,102,0.06)",
                      borderColor: "rgba(168,197,102,0.30)",
                      color: "#F4EFE8",
                    }}
                  >
                    <Calendar className="h-4 w-4 mr-2" style={{ color: "#A8C566" }} />
                    {filters.weekIds.length === 0 ? (
                      <span style={{ color: "#B8B3AA" }}>All Weeks</span>
                    ) : (
                      <span className="truncate">
                        {filteredWeeks.find((w) => w.id === filters.weekIds[0])?.week_name || "1 week"}
                      </span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[320px] p-0" align="start">
                  <div className="p-3 border-b border-border">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-foreground">Select Week</p>
                      <div className="flex gap-2">
                        {filters.weekIds.length > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setFilters((prev) => ({ ...prev, weekIds: [] }))}
                          >
                            Clear
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="max-h-[280px] overflow-y-auto p-2">
                    {filteredWeeks.map((week) => {
                      const isCurrentWeek = week.id === currentWeekId
                      const isSelected = filters.weekIds.includes(week.id)
                      return (
                        <button
                          key={week.id}
                          onClick={() => selectWeek(week.id)}
                          className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg text-left text-sm transition-colors ${
                            isSelected ? "bg-[#8E9B79]/15" : "hover:bg-muted"
                          }`}
                        >
                          {/*
                            Single-select indicator (radio-style). The
                            outer ring uses the same comic-green accent
                            as the rest of the dashboard so the picker
                            visually agrees with the "one week at a
                            time" model — a checkbox here implied
                            multi-select.
                          */}
                          <span
                            aria-hidden
                            className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2"
                            style={{
                              borderColor: isSelected ? "#A8C566" : "rgba(168,197,102,0.35)",
                              backgroundColor: isSelected ? "rgba(168,197,102,0.10)" : "transparent",
                            }}
                          >
                            {isSelected && (
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{ backgroundColor: "#A8C566" }}
                              />
                            )}
                          </span>
                          <span className="flex-1 truncate">{week.week_name}</span>
                          {isCurrentWeek && (
                            <Badge
                              variant="outline"
                              className="text-xs flex-shrink-0"
                              style={{
                                borderColor: "rgba(168,197,102,0.5)",
                                color: "#A8C566",
                                backgroundColor: "rgba(168,197,102,0.1)",
                              }}
                            >
                              Current
                            </Badge>
                          )}
                        </button>
                      )
                    })}
                    {filteredWeeks.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-4">No weeks found</p>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            {/* Team Member Filter */}
            <div className="space-y-2">
              <label className="text-sm font-medium" style={{ color: "#F4EFE8" }}>Team Member</label>
              <Select
                value={filters.teamMemberId}
                onValueChange={(value) => setFilters((prev) => ({ ...prev, teamMemberId: value }))}
              >
                <SelectTrigger
                  style={{
                    backgroundColor: "rgba(168,197,102,0.06)",
                    borderColor: "rgba(168,197,102,0.30)",
                    color: "#F4EFE8",
                  }}
                  className="h-10 hover:bg-[rgba(168,197,102,0.10)]"
                >
                  <Users className="h-4 w-4 mr-2" style={{ color: "#A8C566" }} />
                  <SelectValue placeholder="All Team Members" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Team Members</SelectItem>
                  {teamMembers
                    .filter((m) => m.is_active)
                    .map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {member.full_name}
                      </SelectItem>
                    ))}
                  {teamMembers.filter((m) => !m.is_active).length > 0 && (
                    <>
                      <SelectItem value="-" disabled className="text-muted-foreground text-xs">
                        ── Inactive ──
                      </SelectItem>
                      {teamMembers
                        .filter((m) => !m.is_active)
                        .map((member) => (
                          <SelectItem key={member.id} value={member.id} className="text-muted-foreground">
                            {member.full_name}
                          </SelectItem>
                        ))}
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Leaderboards are split into tabs so the Year-to-Date Standings
          have a dedicated, full-bleed surface and aren't competing with
          the weekly podium for attention. The team filters above apply
          to both tabs (YTD honors only the year filter — multi-week
          and team-member filters intentionally don't constrain
          season-long standings). */}
      <Tabs defaultValue="weekly" className="space-y-4">
        <TabsList
          className="w-full justify-start gap-1 p-1 h-auto"
          style={{
            backgroundColor: "rgba(168,197,102,0.06)",
            borderColor: "rgba(168,197,102,0.25)",
          }}
        >
          <TabsTrigger
            value="weekly"
            className="data-[state=active]:bg-[#A8C566] data-[state=active]:text-[#1D2620] text-[#F4EFE8] hover:bg-[rgba(168,197,102,0.10)] gap-2"
          >
            <Trophy className="h-4 w-4" />
            Weekly Leaderboard
          </TabsTrigger>
          <TabsTrigger
            value="ytd"
            className="data-[state=active]:bg-[#A8C566] data-[state=active]:text-[#1D2620] text-[#F4EFE8] hover:bg-[rgba(168,197,102,0.10)] gap-2"
          >
            <Calendar className="h-4 w-4" />
            Year-to-Date Standings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="weekly" className="m-0">
          <TommyLeaderboard filters={filters} />
        </TabsContent>

        <TabsContent value="ytd" className="m-0">
          <TommyYTDLeaderboard year={filters.year} />
        </TabsContent>
      </Tabs>

      {/* Recent ballots — full-width below the leaderboards now that the
          voting form has its own dedicated /tommy-awards/ballot page. */}
      <TommyRecentBallots filters={filters} />
    </div>
  )
}

function CharacteristicBadge({
  icon,
  label,
  description,
}: { icon: React.ReactNode; label: string; description?: string }) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors"
      style={{
        backgroundColor: "rgba(168,197,102,0.08)",
        borderColor: "rgba(168,197,102,0.25)",
      }}
    >
      <div
        className="p-2 rounded-lg"
        style={{ backgroundColor: "rgba(168,197,102,0.15)" }}
      >
        <span style={{ color: "#A8C566" }}>{icon}</span>
      </div>
      <div>
        <span className="text-sm font-semibold block" style={{ color: "#F4EFE8" }}>{label}</span>
        {description && <span className="text-xs" style={{ color: "#B8B3AA" }}>{description}</span>}
      </div>
    </div>
  )
}
