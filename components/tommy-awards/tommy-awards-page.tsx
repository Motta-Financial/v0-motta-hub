"use client"

import type React from "react"
import Link from "next/link"
import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Checkbox } from "@/components/ui/checkbox"
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

  const toggleWeek = (weekId: string) => {
    setFilters((prev) => {
      const isSelected = prev.weekIds.includes(weekId)
      return {
        ...prev,
        weekIds: isSelected
          ? prev.weekIds.filter((id) => id !== weekId)
          : [...prev.weekIds, weekId],
      }
    })
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
      {/* Brand-themed hero. The previous design used a Patriots-style
          navy + red palette which clashed with the rest of the app. We
          now use Motta's sage/cream brand colors so the page belongs to
          the same visual system as the sidebar and dashboard chrome. */}
      <div className="relative overflow-hidden rounded-2xl border border-[#8E9B79]/40 bg-gradient-to-br from-[#6B745D] via-[#7c876c] to-[#5a6450] text-white">
        <div className="absolute inset-0 opacity-20 pointer-events-none">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(234,230,225,0.45),transparent_55%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_80%,rgba(142,155,121,0.55),transparent_55%)]" />
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#8E9B79] via-[#EAE6E1] to-[#8E9B79]" />
        </div>

        <div className="relative z-10 p-8 lg:p-10">
          <div className="flex flex-col lg:flex-row items-start gap-8">
            {/* Trophy Icon */}
            <div className="relative flex-shrink-0">
              <div className="w-24 h-24 lg:w-28 lg:h-28 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center shadow-2xl shadow-black/20 border border-white/25">
                <Trophy className="h-12 w-12 lg:h-14 lg:w-14 text-white" />
              </div>
            </div>

            {/* Header Content */}
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-3 flex-wrap">
                <Badge className="bg-white/20 hover:bg-white/30 text-white border border-white/30 text-[11px] uppercase tracking-wider">
                  Weekly Peer Recognition
                </Badge>
                <Badge variant="outline" className="border-white/40 text-white/90 text-[11px] uppercase tracking-wider bg-transparent">
                  Motta Financial
                </Badge>
              </div>
              <h1 className="text-4xl lg:text-5xl font-bold tracking-tight mb-3 text-balance">Tommy Awards</h1>
              <p className="text-white/85 text-base lg:text-lg leading-relaxed max-w-3xl text-pretty">
                A weekly vote among all team members of the firm to vote for who they thought represents Tom Brady the
                best — whether with their contributions from a work standpoint, going the extra mile, client wins, and
                most importantly being a good teammate and representing firm culture.
              </p>

              {/* Primary CTA — submit ballot now lives on its own page */}
              <div className="mt-5 flex flex-wrap gap-3">
                <Button
                  asChild
                  size="lg"
                  className="bg-white text-[#6B745D] hover:bg-[#EAE6E1] font-semibold shadow-lg"
                >
                  <Link href="/tommy-awards/ballot" className="inline-flex items-center gap-2">
                    <Send className="h-4 w-4" />
                    Submit This Week&apos;s Ballot
                  </Link>
                </Button>
              </div>
            </div>
          </div>

          {/* Core Characteristics */}
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

      <Card className="border-[#8E9B79]/30 bg-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-[#8E9B79]/20 rounded-lg">
                <Filter className="h-5 w-5 text-[#6B745D]" />
              </div>
              <div>
                <CardTitle className="text-lg">Filter Results</CardTitle>
                <CardDescription>Filter by year, week, or team member</CardDescription>
              </div>
            </div>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
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
              <label className="text-sm font-medium text-foreground">Year</label>
              <Select
                value={filters.year}
                onValueChange={(value) => setFilters((prev) => ({ ...prev, year: value, weekId: "" }))}
              >
                <SelectTrigger>
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
              <label className="text-sm font-medium text-foreground">Week</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start font-normal h-10">
                    <Calendar className="h-4 w-4 mr-2 text-muted-foreground" />
                    {filters.weekIds.length === 0 ? (
                      <span className="text-muted-foreground">All Weeks</span>
                    ) : filters.weekIds.length === 1 ? (
                      <span className="truncate">
                        {filteredWeeks.find((w) => w.id === filters.weekIds[0])?.week_name || "1 week"}
                      </span>
                    ) : (
                      <span>{filters.weekIds.length} weeks selected</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[320px] p-0" align="start">
                  <div className="p-3 border-b border-border">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-foreground">Select Weeks</p>
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
                          onClick={() => toggleWeek(week.id)}
                          className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg text-left text-sm transition-colors ${
                            isSelected ? "bg-[#8E9B79]/15" : "hover:bg-muted"
                          }`}
                        >
                          <Checkbox checked={isSelected} className="pointer-events-none" />
                          <span className="flex-1 truncate">{week.week_name}</span>
                          {isCurrentWeek && (
                            <Badge variant="outline" className="text-xs flex-shrink-0 border-[#8E9B79] text-[#6B745D] bg-[#8E9B79]/10">
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
              <label className="text-sm font-medium text-foreground">Team Member</label>
              <Select
                value={filters.teamMemberId}
                onValueChange={(value) => setFilters((prev) => ({ ...prev, teamMemberId: value }))}
              >
                <SelectTrigger>
                  <Users className="h-4 w-4 mr-2 text-muted-foreground" />
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

      {/* Weekly leaderboard sits ABOVE the year-to-date standings — the
          weekly result is what the team is most curious about right after
          the recap goes out. The widget reads from the same `filters`
          object, so when the user applies a multi-week or year filter
          this section reflects those choices. */}
      <TommyLeaderboard filters={filters} />

      {/* Year-to-Date Standings (with embedded Scoring System) */}
      <TommyYTDLeaderboard year={filters.year} />

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
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/10 backdrop-blur-sm border border-white/20 hover:bg-white/15 transition-colors">
      <div className="p-2 rounded-lg bg-white/15">
        <span className="text-white">{icon}</span>
      </div>
      <div>
        <span className="text-sm font-semibold text-white block">{label}</span>
        {description && <span className="text-xs text-white/70">{description}</span>}
      </div>
    </div>
  )
}
