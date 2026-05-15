"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Trophy, Medal, Award } from "lucide-react"
import { findHeroProfile } from "@/lib/motta-alliance/hero-profiles"

interface LeaderboardEntry {
  name: string
  first_place_votes: number
  second_place_votes: number
  third_place_votes: number
  honorable_mention_votes: number
  partner_votes: number
  total_points: number
  rank: number
}

interface Filters {
  year: string
  weekIds: string[]
  teamMemberId: string
}

interface TommyLeaderboardProps {
  filters: Filters
}

export function TommyLeaderboard({ filters }: TommyLeaderboardProps) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [totalBallots, setTotalBallots] = useState(0)
  const [loading, setLoading] = useState(true)

  const is2026OrLater = filters.year !== "all" && Number.parseInt(filters.year) >= 2026

  useEffect(() => {
    fetchLeaderboard()
  }, [filters])

  const fetchLeaderboard = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ type: "leaderboard" })
      if (filters.year && filters.year !== "all") params.append("year", filters.year)
      if (filters.weekIds.length > 0) params.append("week_ids", filters.weekIds.join(","))

      const res = await fetch(`/api/tommy-awards?${params}`)
      const data = await res.json()

      setLeaderboard(data.leaderboard || [])
      setTotalBallots(data.total_ballots || 0)
    } catch (error) {
      console.error("Error fetching leaderboard:", error)
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
        return <Trophy className="h-6 w-6 text-amber-500" />
      case 2:
        return <Medal className="h-6 w-6 text-slate-400" />
      case 3:
        return <Award className="h-6 w-6 text-amber-700" />
      default:
        return <span className="text-lg font-bold text-muted-foreground">#{rank}</span>
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
        return "bg-white border-border"
    }
  }

  const getFilterDescription = () => {
    const parts: string[] = []
    if (filters.year && filters.year !== "all") parts.push(filters.year)
    if (filters.weekIds.length === 1) parts.push("1 Week")
    else if (filters.weekIds.length > 1) parts.push(`${filters.weekIds.length} Weeks`)
    return parts.length > 0 ? parts.join(" - ") : "All Time"
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
        <CardContent className="flex items-center justify-center h-64">
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
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-3" style={{ color: "#F4EFE8" }}>
            <div
              className="p-2 rounded-lg"
              style={{ backgroundColor: "rgba(168,197,102,0.15)" }}
            >
              <Trophy className="h-5 w-5" style={{ color: "#A8C566" }} />
            </div>
            Weekly Leaderboard
          </CardTitle>
          <div className="text-right">
            <p className="text-sm font-medium" style={{ color: "#F4EFE8" }}>{getFilterDescription()}</p>
            <p className="text-xs" style={{ color: "#B8B3AA" }}>{totalBallots} ballots</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {leaderboard.length === 0 ? (
          <div className="text-center py-8" style={{ color: "#B8B3AA" }}>
            <Trophy className="h-12 w-12 mx-auto mb-3 opacity-30" style={{ color: "#A8C566" }} />
            <p>No votes recorded for this period</p>
          </div>
        ) : (
          <div className="space-y-3">
            {leaderboard.map((entry) => {
              const hero = findHeroProfile(entry.name)
              return (
              <div
                key={entry.name}
                className="flex items-center gap-4 p-4 rounded-xl border-2 transition-all hover:shadow-lg"
                style={{
                  backgroundColor: entry.rank === 1
                    ? "rgba(230,168,92,0.12)"
                    : entry.rank === 2
                      ? "rgba(168,197,102,0.08)"
                      : entry.rank === 3
                        ? "rgba(230,168,92,0.06)"
                        : "rgba(168,197,102,0.04)",
                  borderColor: entry.rank === 1
                    ? "rgba(230,168,92,0.40)"
                    : entry.rank === 2
                      ? "rgba(168,197,102,0.30)"
                      : entry.rank === 3
                        ? "rgba(230,168,92,0.25)"
                        : "rgba(168,197,102,0.15)",
                }}
              >
                <div className="w-10 flex justify-center">{getRankIcon(entry.rank)}</div>
                <Avatar
                  className="h-12 w-12 border-2 shadow-sm"
                  style={{ borderColor: "rgba(168,197,102,0.30)" }}
                  title={hero ? `${hero.name} — ${hero.alias}` : entry.name}
                >
                  <AvatarImage
                    src={hero?.imageUrl || "/placeholder.svg"}
                    alt={hero ? `${entry.name} — ${hero.alias}` : entry.name}
                    className="object-cover object-top"
                  />
                  <AvatarFallback
                    className="font-semibold"
                    style={{
                      background: "linear-gradient(135deg, #0F140C, #1a1f15)",
                      color: "#A8C566",
                    }}
                  >
                    {getInitials(entry.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate" style={{ color: "#F4EFE8" }}>{entry.name}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {entry.first_place_votes > 0 && (
                      <Badge
                        variant="outline"
                        className="text-xs"
                        style={{
                          backgroundColor: "rgba(230,168,92,0.15)",
                          color: "#E6A85C",
                          borderColor: "rgba(230,168,92,0.40)",
                        }}
                      >
                        {entry.first_place_votes} First
                      </Badge>
                    )}
                    {entry.second_place_votes > 0 && (
                      <Badge
                        variant="outline"
                        className="text-xs"
                        style={{
                          backgroundColor: "rgba(168,197,102,0.10)",
                          color: "#A8C566",
                          borderColor: "rgba(168,197,102,0.35)",
                        }}
                      >
                        {entry.second_place_votes} Second
                      </Badge>
                    )}
                    {entry.third_place_votes > 0 && (
                      <Badge
                        variant="outline"
                        className="text-xs"
                        style={{
                          backgroundColor: "rgba(230,168,92,0.10)",
                          color: "#E6A85C",
                          borderColor: "rgba(230,168,92,0.30)",
                        }}
                      >
                        {entry.third_place_votes} Third
                      </Badge>
                    )}
                    {!is2026OrLater && entry.honorable_mention_votes > 0 && (
                      <Badge
                        variant="outline"
                        className="text-xs"
                        style={{
                          backgroundColor: "rgba(168,197,102,0.06)",
                          color: "#B8B3AA",
                          borderColor: "rgba(168,197,102,0.20)",
                        }}
                      >
                        {entry.honorable_mention_votes} HM
                      </Badge>
                    )}
                    {!is2026OrLater && entry.partner_votes > 0 && (
                      <Badge
                        variant="outline"
                        className="text-xs"
                        style={{
                          backgroundColor: "rgba(168,197,102,0.12)",
                          color: "#A8C566",
                          borderColor: "rgba(168,197,102,0.40)",
                        }}
                      >
                        {entry.partner_votes} Partner
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold" style={{ color: "#F4EFE8" }}>{entry.total_points}</p>
                  <p className="text-xs" style={{ color: "#B8B3AA" }}>points</p>
                </div>
              </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
