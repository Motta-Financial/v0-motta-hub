"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Trophy,
  Flame,
  Target,
  Users,
  Zap,
  Calendar,
  Filter,
  X,
  Instagram,
  Twitter,
  Youtube,
  ExternalLink,
} from "lucide-react"
import { TommyLeaderboard } from "./tommy-leaderboard"
import { TommyVotingForm } from "./tommy-voting-form"
import { TommyRecentBallots } from "./tommy-recent-ballots"
import Image from "next/image"

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
  weekId: string
  teamMemberId: string
}

export function TommyAwardsPage() {
  const [weeks, setWeeks] = useState<Week[]>([])
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [filters, setFilters] = useState<Filters>({
    year: new Date().getFullYear().toString(),
    weekId: "",
    teamMemberId: "",
  })
  const [filteredWeeks, setFilteredWeeks] = useState<Week[]>([])

  const is2026OrLater = filters.year === "all" ? false : Number.parseInt(filters.year) >= 2026

  useEffect(() => {
    fetchFilterData()
  }, [])

  useEffect(() => {
    // Filter weeks by selected year
    if (filters.year) {
      const yearWeeks = weeks.filter((week) => week.week_date.startsWith(filters.year))
      setFilteredWeeks(yearWeeks)
      // Reset week selection if not in filtered year
      if (filters.weekId && !yearWeeks.find((w) => w.id === filters.weekId)) {
        setFilters((prev) => ({ ...prev, weekId: "" }))
      }
    } else {
      setFilteredWeeks(weeks)
    }
  }, [filters.year, weeks])

  const fetchFilterData = async () => {
    try {
      // Fetch weeks
      const weeksRes = await fetch("/api/tommy-awards?type=weeks")
      const weeksData = await weeksRes.json()
      setWeeks(weeksData.weeks || [])

      // Fetch team members
      const membersRes = await fetch("/api/tommy-awards?type=team_members")
      const membersData = await membersRes.json()
      setTeamMembers(membersData.team_members || [])
    } catch (error) {
      console.error("Error fetching filter data:", error)
    }
  }

  const clearFilters = () => {
    setFilters({
      year: new Date().getFullYear().toString(),
      weekId: "",
      teamMemberId: "",
    })
  }

  const hasActiveFilters =
    filters.weekId || filters.teamMemberId || filters.year !== new Date().getFullYear().toString()

  // Get unique years from weeks
  const years = [...new Set(weeks.map((w) => w.week_date.substring(0, 4)))].sort((a, b) => b.localeCompare(a))

  return (
    <div className="space-y-8">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0a1628] via-[#1a2744] to-[#0d1e36] text-white">
        {/* Patriots/Brady inspired background pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(198,40,40,0.3),transparent_50%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_80%,rgba(0,59,111,0.4),transparent_50%)]" />
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#c62828] via-[#d32f2f] to-[#c62828]" />
        </div>

        <div className="relative z-10 p-8">
          <div className="flex flex-col lg:flex-row items-start lg:items-center gap-8">
            {/* Tom Brady Image */}
            <div className="relative flex-shrink-0">
              <div className="w-32 h-32 lg:w-40 lg:h-40 rounded-full overflow-hidden border-4 border-[#c62828] shadow-2xl shadow-red-900/30">
                <Image
                  src="/images/tom-20brady.jpg"
                  alt="Tom Brady"
                  width={160}
                  height={160}
                  className="object-cover w-full h-full"
                />
              </div>
              <div className="absolute -bottom-2 -right-2 bg-[#c62828] rounded-full p-2 shadow-lg">
                <Trophy className="h-6 w-6 text-white" />
              </div>
            </div>

            {/* Header Content */}
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <Badge className="bg-[#c62828] hover:bg-[#b71c1c] text-white border-0 text-xs uppercase tracking-wider">
                  7x Super Bowl Champion
                </Badge>
                <Badge variant="outline" className="border-slate-500 text-slate-300 text-xs uppercase tracking-wider">
                  TB12
                </Badge>
              </div>
              <h1 className="text-4xl lg:text-5xl font-bold tracking-tight mb-2">Tommy Awards</h1>
              <p className="text-slate-300 text-lg mb-4">
                Weekly recognition for demonstrating championship characteristics
              </p>

              {/* Tom Brady Quote */}
              <blockquote className="border-l-4 border-[#c62828] pl-4 italic text-slate-400 mb-6">
                "I didn't come this far to only come this far."
                <span className="block text-sm mt-1 text-slate-500 not-italic">— Tom Brady</span>
              </blockquote>

              {/* Social Links */}
              <div className="flex items-center gap-3">
                <a
                  href="https://www.instagram.com/tombrady/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors group"
                >
                  <Instagram className="h-5 w-5 text-slate-300 group-hover:text-white" />
                </a>
                <a
                  href="https://twitter.com/TomBrady"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors group"
                >
                  <Twitter className="h-5 w-5 text-slate-300 group-hover:text-white" />
                </a>
                <a
                  href="https://www.youtube.com/@TomBrady"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors group"
                >
                  <Youtube className="h-5 w-5 text-slate-300 group-hover:text-white" />
                </a>
                <a
                  href="https://tb12sports.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors group text-sm"
                >
                  <span className="text-slate-300 group-hover:text-white">TB12 Method</span>
                  <ExternalLink className="h-4 w-4 text-slate-400 group-hover:text-white" />
                </a>
              </div>
            </div>
          </div>

          {/* Tom Brady Characteristics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-8">
            <CharacteristicBadge
              icon={<Flame className="h-5 w-5" />}
              label="Leadership"
              description="Lead by example"
            />
            <CharacteristicBadge
              icon={<Target className="h-5 w-5" />}
              label="Excellence"
              description="Relentless pursuit"
            />
            <CharacteristicBadge icon={<Users className="h-5 w-5" />} label="Teamwork" description="Elevate others" />
            <CharacteristicBadge icon={<Zap className="h-5 w-5" />} label="Dedication" description="Outwork everyone" />
          </div>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-xl bg-gradient-to-r from-[#0a1628] to-[#1a2744] p-6 text-center">
        <div className="absolute inset-0 opacity-5">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: "url(/placeholder.svg?height=200&width=1200&query=football field lines pattern)",
              backgroundSize: "cover",
            }}
          />
        </div>
        <p className="relative z-10 text-xl lg:text-2xl font-medium text-white italic">
          "You wanna know which ring is my favorite? The next one."
        </p>
        <p className="relative z-10 text-sm text-slate-400 mt-2">— Tom Brady</p>
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

            {/* Week Filter */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Week</label>
              <Select
                value={filters.weekId}
                onValueChange={(value) => setFilters((prev) => ({ ...prev, weekId: value }))}
              >
                <SelectTrigger>
                  <Calendar className="h-4 w-4 mr-2 text-muted-foreground" />
                  <SelectValue placeholder="All Weeks" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Weeks</SelectItem>
                  {filteredWeeks.map((week) => (
                    <SelectItem key={week.id} value={week.id}>
                      {week.week_name}
                      {week.is_active && (
                        <Badge variant="outline" className="ml-2 text-xs">
                          Current
                        </Badge>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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

      <Card className="border-border bg-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Scoring System</CardTitle>
              <CardDescription>
                {is2026OrLater
                  ? "2026+ Simplified Scoring - Top 3 only"
                  : filters.year === "2025" || filters.year === "all"
                    ? "How points are awarded each week"
                    : "How points are awarded each week"}
              </CardDescription>
            </div>
            {(filters.year === "all" || Number.parseInt(filters.year) < 2026) &&
              Number.parseInt(filters.year || "2026") !== 2026 && (
                <Badge variant="outline" className="text-xs">
                  {filters.year === "all" ? "Legacy + Current" : filters.year + " Rules"}
                </Badge>
              )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 px-3 py-1.5">
              🥇 1st Place: 3 Points
            </Badge>
            <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200 px-3 py-1.5">
              🥈 2nd Place: 2 Points
            </Badge>
            <Badge variant="outline" className="bg-orange-50 text-orange-600 border-orange-200 px-3 py-1.5">
              🥉 3rd Place: 1 Point
            </Badge>
            {!is2026OrLater && (filters.year === "all" || Number.parseInt(filters.year) <= 2025) && (
              <>
                <Badge variant="outline" className="bg-blue-50 text-blue-600 border-blue-200 px-3 py-1.5 opacity-75">
                  Honorable Mention: 0.5 Points
                  <span className="ml-1 text-xs">(2025 only)</span>
                </Badge>
                <Badge
                  variant="outline"
                  className="bg-emerald-50 text-emerald-700 border-emerald-200 px-3 py-1.5 opacity-75"
                >
                  Partner Vote: 5 Points
                  <span className="ml-1 text-xs">(2025 only)</span>
                </Badge>
              </>
            )}
          </div>
          {is2026OrLater && (
            <p className="text-sm text-muted-foreground mt-3">
              Starting in 2026, Tommy Awards uses a streamlined scoring system with 1st, 2nd, and 3rd place votes only.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left Column - Voting Form */}
        <div>
          <TommyVotingForm />
        </div>

        {/* Right Column - Leaderboard & Recent */}
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
