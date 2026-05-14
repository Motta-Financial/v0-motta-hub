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
      <Card
        className="border-2"
        style={{
          backgroundColor: "#0F140C",
          borderColor: "rgba(168,197,102,0.25)",
        }}
      >
        <CardContent className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: "#A8C566" }}></div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card
      className="border-2"
      style={{
        backgroundColor: "#0F140C",
        borderColor: "rgba(168,197,102,0.25)",
      }}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div
              className="p-2 rounded-lg"
              style={{ backgroundColor: "rgba(168,197,102,0.15)" }}
            >
              <TrendingUp className="h-5 w-5" style={{ color: "#A8C566" }} />
            </div>
            <div>
              <CardTitle style={{ color: "#F4EFE8" }}>{displayYear} Year-to-Date Standings</CardTitle>
              <CardDescription style={{ color: "#B8B3AA" }}>Season-long standings & scoring system</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              variant="outline"
              style={{
                backgroundColor: "rgba(168,197,102,0.10)",
                color: "#A8C566",
                borderColor: "rgba(168,197,102,0.35)",
              }}
            >
              <Calendar className="h-3 w-3 mr-1" />
              {totalWeeks} {totalWeeks === 1 ? "week" : "weeks"}
            </Badge>
            <Badge
              variant="outline"
              style={{
                backgroundColor: "rgba(230,168,92,0.10)",
                color: "#E6A85C",
                borderColor: "rgba(230,168,92,0.35)",
              }}
            >
              {totalBallots} ballots
            </Badge>
          </div>
        </div>

        {/* Embedded Scoring System */}
        <div
          className="mt-3 pt-3 border-t"
          style={{ borderColor: "rgba(168,197,102,0.20)" }}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="text-xs font-medium uppercase tracking-wide mr-1"
              style={{ color: "#B8B3AA" }}
            >
              Scoring:
            </span>
            <Badge
              variant="outline"
              className="text-xs"
              style={{
                backgroundColor: "rgba(230,168,92,0.15)",
                color: "#E6A85C",
                borderColor: "rgba(230,168,92,0.40)",
              }}
            >
              <Trophy className="h-3 w-3 mr-1" />
              1st: 3 pts
            </Badge>
            <Badge
              variant="outline"
              className="text-xs"
              style={{
                backgroundColor: "rgba(168,197,102,0.10)",
                color: "#A8C566",
                borderColor: "rgba(168,197,102,0.35)",
              }}
            >
              <Medal className="h-3 w-3 mr-1" />
              2nd: 2 pts
            </Badge>
            <Badge
              variant="outline"
              className="text-xs"
              style={{
                backgroundColor: "rgba(230,168,92,0.10)",
                color: "#E6A85C",
                borderColor: "rgba(230,168,92,0.30)",
              }}
            >
              <Award className="h-3 w-3 mr-1" />
              3rd: 1 pt
            </Badge>
            {!isYear2026OrLater && (
              <>
                <Badge
                  variant="outline"
                  className="text-xs opacity-75"
                  style={{
                    backgroundColor: "rgba(168,197,102,0.06)",
                    color: "#B8B3AA",
                    borderColor: "rgba(168,197,102,0.20)",
                  }}
                >
                  HM: 0.5 pts
                </Badge>
                <Badge
                  variant="outline"
                  className="text-xs opacity-75"
                  style={{
                    backgroundColor: "rgba(168,197,102,0.10)",
                    color: "#A8C566",
                    borderColor: "rgba(168,197,102,0.30)",
                  }}
                >
                  Partner: 5 pts
                </Badge>
              </>
            )}
            {isYear2026OrLater && (
              <span className="text-xs italic ml-1" style={{ color: "#B8B3AA" }}>
                (Top 3 only — streamlined for 2026+)
              </span>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {entries.length === 0 ? (
          <div className="text-center py-8" style={{ color: "#B8B3AA" }}>
            <Trophy className="h-10 w-10 mx-auto mb-2 opacity-30" style={{ color: "#A8C566" }} />
            <p className="text-sm">No votes recorded for {displayYear} yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {entries.map((entry) => (
              <div
                key={entry.name}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg border-2 transition-all hover:shadow-lg"
                style={{
                  backgroundColor: entry.rank === 1
                    ? "rgba(230,168,92,0.10)"
                    : entry.rank === 2
                      ? "rgba(168,197,102,0.06)"
                      : entry.rank === 3
                        ? "rgba(230,168,92,0.05)"
                        : "rgba(168,197,102,0.03)",
                  borderColor: entry.rank === 1
                    ? "rgba(230,168,92,0.35)"
                    : entry.rank === 2
                      ? "rgba(168,197,102,0.25)"
                      : entry.rank === 3
                        ? "rgba(230,168,92,0.20)"
                        : "rgba(168,197,102,0.12)",
                }}
              >
                <div className="w-7 flex justify-center flex-shrink-0">{getRankIcon(entry.rank)}</div>

                <Avatar
                  className="h-9 w-9 border-2 shadow-sm flex-shrink-0"
                  style={{ borderColor: "rgba(168,197,102,0.25)" }}
                >
                  <AvatarFallback
                    className="font-semibold text-xs"
                    style={{
                      background: "linear-gradient(135deg, #0F140C, #1a1f15)",
                      color: "#A8C566",
                    }}
                  >
                    {getInitials(entry.name)}
                  </AvatarFallback>
                </Avatar>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-sm truncate" style={{ color: "#F4EFE8" }}>{entry.name}</p>
                    {/* Inline weekly podium pills */}
                    {entry.weeks_in_first > 0 && (
                      <span
                        className="text-[11px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap"
                        style={{
                          backgroundColor: "rgba(230,168,92,0.20)",
                          color: "#E6A85C",
                        }}
                      >
                        {entry.weeks_in_first}× 1st
                      </span>
                    )}
                    {entry.weeks_in_second > 0 && (
                      <span
                        className="text-[11px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap"
                        style={{
                          backgroundColor: "rgba(168,197,102,0.15)",
                          color: "#A8C566",
                        }}
                      >
                        {entry.weeks_in_second}× 2nd
                      </span>
                    )}
                    {entry.weeks_in_third > 0 && (
                      <span
                        className="text-[11px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap"
                        style={{
                          backgroundColor: "rgba(230,168,92,0.12)",
                          color: "#E6A85C",
                        }}
                      >
                        {entry.weeks_in_third}× 3rd
                      </span>
                    )}
                  </div>

                  {/* Vote counts on second line */}
                  <div className="flex items-center gap-x-3 gap-y-0.5 mt-0.5 text-[11px] flex-wrap" style={{ color: "#B8B3AA" }}>
                    <span>
                      <strong style={{ color: "#F4EFE8" }}>{entry.first_place_votes}</strong> 1st
                    </span>
                    <span>
                      <strong style={{ color: "#F4EFE8" }}>{entry.second_place_votes}</strong> 2nd
                    </span>
                    <span>
                      <strong style={{ color: "#F4EFE8" }}>{entry.third_place_votes}</strong> 3rd
                    </span>
                    {!isYear2026OrLater && entry.honorable_mention_votes > 0 && (
                      <span>
                        <strong style={{ color: "#F4EFE8" }}>{entry.honorable_mention_votes}</strong> HM
                      </span>
                    )}
                    {!isYear2026OrLater && entry.partner_votes > 0 && (
                      <span>
                        <strong style={{ color: "#F4EFE8" }}>{entry.partner_votes}</strong> partner
                      </span>
                    )}
                  </div>
                </div>

                <div className="text-right flex-shrink-0 ml-2">
                  <p className="text-xl font-bold leading-none" style={{ color: "#F4EFE8" }}>{entry.total_points}</p>
                  <p className="text-[10px] uppercase tracking-wide" style={{ color: "#B8B3AA" }}>pts</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
