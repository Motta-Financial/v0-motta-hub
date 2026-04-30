"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Checkbox } from "@/components/ui/checkbox"
import { Trophy, Flame, Target, Users, Zap, Calendar, Filter, X } from "lucide-react"
import { TommyLeaderboard } from "./tommy-leaderboard"
import { TommyYTDLeaderboard } from "./tommy-ytd-leaderboard"
import { TommyVotingForm } from "./tommy-voting-form"
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
      // Fetch weeks
      const weeksRes = await fetch("/api/tommy-awards?type=weeks")
      const weeksData = await weeksRes.json()
      const fetchedWeeks: Week[] = dedupeWeeks(weeksData.weeks || [])
      setWeeks(fetchedWeeks)

      // Detect current week and set it as default
      const currentFriday = getCurrentWeekDate()
      const currentWeek = fetchedWeeks.find((w) => w.week_date === currentFriday)
      if (currentWeek) {
        setCurrentWeekId(currentWeek.id)
        setFilters((prev) => ({ ...prev, weekIds: [currentWeek.id] }))
      }

      // Fetch team members
      const membersRes = await fetch("/api/tommy-awards?type=team_members")
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
      weekIds: currentWeekId ? [currentWeekId] : [],
      teamMemberId: "",
    })
  }

  const hasActiveFilters =
    filters.weekIds.length > (currentWeekId ? 1 : 0) ||
    (currentWeekId && filters.weekIds.length === 1 && filters.weekIds[0] !== currentWeekId) ||
    filters.teamMemberId ||
    filters.year !== new Date().getFullYear().toString()

  // Get unique years from weeks
  const years = [...new Set(weeks.map((w) => w.week_date.substring(0, 4)))].sort((a, b) => b.localeCompare(a))

  return (
    <div className="space-y-8">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0a1628] via-[#1a2744] to-[#0d1e36] text-white">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(198,40,40,0.3),transparent_50%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_80%,rgba(0,59,111,0.4),transparent_50%)]" />
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#c62828] via-[#d32f2f] to-[#c62828]" />
        </div>

        <div className="relative z-10 p-8 lg:p-10">
          <div className="flex flex-col lg:flex-row items-start gap-8">
            {/* Trophy Icon */}
            <div className="relative flex-shrink-0">
              <div className="w-24 h-24 lg:w-28 lg:h-28 rounded-2xl bg-gradient-to-br from-[#c62828] to-[#8b1c1c] flex items-center justify-center shadow-2xl shadow-red-900/30 border border-white/10">
                <Trophy className="h-12 w-12 lg:h-14 lg:w-14 text-white" />
              </div>
            </div>

            {/* Header Content */}
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-3">
                <Badge className="bg-[#c62828] hover:bg-[#b71c1c] text-white border-0 text-xs uppercase tracking-wider">
                  Weekly Peer Recognition
                </Badge>
                <Badge variant="outline" className="border-slate-500 text-slate-300 text-xs uppercase tracking-wider">
                  Motta Financial
                </Badge>
              </div>
              <h1 className="text-4xl lg:text-5xl font-bold tracking-tight mb-3 text-balance">Tommy Awards</h1>
              <p className="text-slate-200 text-base lg:text-lg leading-relaxed max-w-3xl text-pretty">
                A weekly vote among all team members of the firm to vote for who they thought represents Tom Brady the
                best — whether with their contributions from a work standpoint, going the extra mile, client wins, and
                most importantly being a good teammate and representing firm culture.
              </p>
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

      <Card className="border-border bg-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Filter className="h-5 w-5 text-blue-600" />
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
                            isSelected ? "bg-accent" : "hover:bg-muted"
                          }`}
                        >
                          <Checkbox checked={isSelected} className="pointer-events-none" />
                          <span className="flex-1 truncate">{week.week_name}</span>
                          {isCurrentWeek && (
                            <Badge variant="outline" className="text-xs flex-shrink-0 border-green-300 text-green-700 bg-green-50">
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

      {/* Year-to-Date Standings (with embedded Scoring System) */}
      <TommyYTDLeaderboard year={filters.year} />

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left Column - Voting Form */}
        <div>
          <TommyVotingForm />
        </div>

        {/* Right Column - Filtered Leaderboard & Recent */}
        <div className="space-y-8">
          <TommyLeaderboard filters={filters} />
          <TommyRecentBallots filters={filters} />
        </div>
      </div>
    </div>
  )
}

function CharacteristicBadge({
  icon,
  label,
  description,
}: { icon: React.ReactNode; label: string; description?: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 backdrop-blur-sm border border-white/10 hover:bg-white/10 transition-colors">
      <div className="p-2 rounded-lg bg-[#c62828]/20">
        <span className="text-[#c62828]">{icon}</span>
      </div>
      <div>
        <span className="text-sm font-semibold text-white block">{label}</span>
        {description && <span className="text-xs text-slate-400">{description}</span>}
      </div>
    </div>
  )
}
