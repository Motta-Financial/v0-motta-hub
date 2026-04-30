"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Trophy, Medal, Award, TrendingUp, Calendar } from "lucide-react"

interface YTDEntry {
  name: string
  total_points: number
  first_place_votes: number
  second_place_votes: number
  third_place_votes: number
  honorable_mention_votes: number
  partner_votes: number
  weeks_in_first: number
  weeks_in_second: number
  weeks_in_third: number
  weeks_participated: number
  rank: number
}

interface TommyYTDLeaderboardProps {
  year: string
}

export function TommyYTDLeaderboard({ year }: TommyYTDLeaderboardProps) {
  const [entries, setEntries] = useState<YTDEntry[]>([])
  const [totalWeeks, setTotalWeeks] = useState(0)
  const [totalBallots, setTotalBallots] = useState(0)
  const [loading, setLoading] = useState(true)

  const displayYear = year === "all" ? new Date().getFullYear().toString() : year
  const isYear2026OrLater = Number.parseInt(displayYear) >= 2026

  useEffect(() => {
    fetchYTDStats()
  }, [displayYear])

  const fetchYTDStats = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ type: "ytd_stats", year: displayYear })
      const res = await fetch(`/api/tommy-awards?${params}`)
      const data = await res.json()
      setEntries(data.ytd_leaderboard || [])
      setTotalWeeks(data.total_weeks || 0)
      setTotalBallots(data.total_ballots || 0)
    } catch (error) {
      console.error("Error fetching YTD stats:", error)
    } finally {
      setLoading(false)
    }
  }

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2)
  }

  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1:
        return <Trophy className="h-5 w-5 text-amber-500" />
      case 2:
        return <Medal className="h-5 w-5 text-slate-400" />
      case 3:
        return <Award className="h-5 w-5 text-amber-700" />
      default:
        return <span className="text-sm font-bold text-muted-foreground">#{rank}</span>
    }
  }

  const getRankBg = (rank: number) => {
    switch (rank) {
      case 1:
        return "bg-gradient-to-r from-amber-50 to-yellow-50 border-amber-200"
      case 2:
        return "bg-gradient-to-r from-slate-50 to-gray-50 border-slate-200"
      case 3:
        return "bg-gradient-to-r from-orange-50 to-amber-50 border-orange-200"
      default:
        return "bg-card border-border"
    }
  }

  if (loading) {
    return (
      <Card className="border-border">
        <CardContent className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground"></div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 rounded-lg">
              <TrendingUp className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <CardTitle className="text-foreground">{displayYear} Year-to-Date Standings</CardTitle>
              <CardDescription>Season-long standings & scoring system</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
              <Calendar className="h-3 w-3 mr-1" />
              {totalWeeks} {totalWeeks === 1 ? "week" : "weeks"}
            </Badge>
            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
              {totalBallots} ballots
            </Badge>
          </div>
        </div>

        {/* Embedded Scoring System */}
        <div className="mt-3 pt-3 border-t border-border">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide mr-1">
              Scoring:
            </span>
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-xs">
              <Trophy className="h-3 w-3 mr-1" />
              1st: 3 pts
            </Badge>
            <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200 text-xs">
              <Medal className="h-3 w-3 mr-1" />
              2nd: 2 pts
            </Badge>
            <Badge variant="outline" className="bg-orange-50 text-orange-600 border-orange-200 text-xs">
              <Award className="h-3 w-3 mr-1" />
              3rd: 1 pt
            </Badge>
            {!isYear2026OrLater && (
              <>
                <Badge variant="outline" className="bg-blue-50 text-blue-600 border-blue-200 text-xs opacity-75">
                  HM: 0.5 pts
                </Badge>
                <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs opacity-75">
                  Partner: 5 pts
                </Badge>
              </>
            )}
            {isYear2026OrLater && (
              <span className="text-xs text-muted-foreground italic ml-1">
                (Top 3 only — streamlined for 2026+)
              </span>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {entries.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Trophy className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No votes recorded for {displayYear} yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {entries.map((entry) => (
              <div
                key={entry.name}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all hover:shadow-sm ${getRankBg(entry.rank)}`}
              >
                <div className="w-7 flex justify-center flex-shrink-0">{getRankIcon(entry.rank)}</div>

                <Avatar className="h-9 w-9 border-2 border-white shadow-sm flex-shrink-0">
                  <AvatarFallback className="bg-gradient-to-br from-[#c62828] to-[#b71c1c] text-white font-semibold text-xs">
                    {getInitials(entry.name)}
                  </AvatarFallback>
                </Avatar>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-foreground text-sm truncate">{entry.name}</p>
                    {/* Inline weekly podium pills */}
                    {entry.weeks_in_first > 0 && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-medium whitespace-nowrap">
                        {entry.weeks_in_first}× 1st
                      </span>
                    )}
                    {entry.weeks_in_second > 0 && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-medium whitespace-nowrap">
                        {entry.weeks_in_second}× 2nd
                      </span>
                    )}
                    {entry.weeks_in_third > 0 && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-800 font-medium whitespace-nowrap">
                        {entry.weeks_in_third}× 3rd
                      </span>
                    )}
                  </div>

                  {/* Vote counts on second line */}
                  <div className="flex items-center gap-x-3 gap-y-0.5 mt-0.5 text-[11px] text-muted-foreground flex-wrap">
                    <span>
                      <strong className="text-foreground">{entry.first_place_votes}</strong> 1st
                    </span>
                    <span>
                      <strong className="text-foreground">{entry.second_place_votes}</strong> 2nd
                    </span>
                    <span>
                      <strong className="text-foreground">{entry.third_place_votes}</strong> 3rd
                    </span>
                    {!isYear2026OrLater && entry.honorable_mention_votes > 0 && (
                      <span>
                        <strong className="text-foreground">{entry.honorable_mention_votes}</strong> HM
                      </span>
                    )}
                    {!isYear2026OrLater && entry.partner_votes > 0 && (
                      <span>
                        <strong className="text-foreground">{entry.partner_votes}</strong> partner
                      </span>
                    )}
                  </div>
                </div>

                <div className="text-right flex-shrink-0 ml-2">
                  <p className="text-xl font-bold text-foreground leading-none">{entry.total_points}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">pts</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
