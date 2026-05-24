"use client"

// Weekly Stats — KPI strip that complements the Weekly Leaderboard.
//
// Renders below the recent-ballots feed on the Weekly tab. Surfaces the
// same firm-wide metrics the user cares about for the selected week(s):
//   • Total ballots cast
//   • Total points distributed
//   • Top point-getter (with vote share %)
//   • Vote share table — points received ÷ firm total points cast
//
// Vote share is the same definition used on the KPI Leaderboard:
// per-teammate `total_points / firm_total_points`. Scoped to whatever
// the parent filter has selected (single week, multi-week, or whole
// year), so the table is comparable to what's shown on the leaderboard
// above.

import { useEffect, useState } from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Sparkles, Crown, Target, ListChecks } from "lucide-react"
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

interface TommyWeeklyStatsProps {
  filters: Filters
}

const NUMBER_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
})

const PERCENT_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
})

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

function describeFilter(filters: Filters) {
  if (filters.weekIds.length === 1) return "Selected week"
  if (filters.weekIds.length > 1) return `${filters.weekIds.length} weeks`
  if (filters.year && filters.year !== "all") return filters.year
  return "All time"
}

export function TommyWeeklyStats({ filters }: TommyWeeklyStatsProps) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [totalBallots, setTotalBallots] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function fetchData() {
      setLoading(true)
      try {
        const params = new URLSearchParams({ type: "leaderboard" })
        if (filters.year && filters.year !== "all")
          params.append("year", filters.year)
        if (filters.weekIds.length > 0)
          params.append("week_ids", filters.weekIds.join(","))
        const res = await fetch(`/api/tommy-awards?${params}`)
        const json = await res.json()
        if (cancelled) return
        setEntries(json.leaderboard || [])
        setTotalBallots(json.total_ballots || 0)
      } catch (err) {
        console.error("[v0] tommy weekly stats fetch failed:", err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchData()
    return () => {
      cancelled = true
    }
  }, [filters])

  const totalPoints = entries.reduce((acc, e) => acc + e.total_points, 0)
  const sortedByShare = [...entries].sort(
    (a, b) => b.total_points - a.total_points,
  )
  const topScorer = sortedByShare[0]
  const topVoteShare =
    topScorer && totalPoints > 0 ? topScorer.total_points / totalPoints : 0

  const filterLabel = describeFilter(filters)

  return (
    <Card
      className="border-2"
      style={{
        backgroundColor: "#0F140C",
        borderColor: "rgba(168,197,102,0.25)",
      }}
    >
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle
            className="flex items-center gap-3"
            style={{ color: "#F4EFE8" }}
          >
            <div
              className="p-2 rounded-lg"
              style={{ backgroundColor: "rgba(168,197,102,0.15)" }}
            >
              <Sparkles className="h-5 w-5" style={{ color: "#A8C566" }} />
            </div>
            Weekly Stats
          </CardTitle>
          <div className="text-right">
            <p className="text-sm font-medium" style={{ color: "#F4EFE8" }}>
              {filterLabel}
            </p>
            <p className="text-xs" style={{ color: "#B8B3AA" }}>
              {totalBallots} ballots · {NUMBER_FORMATTER.format(totalPoints)}{" "}
              points
            </p>
          </div>
        </div>
        <CardDescription className="text-[#F4EFE8]/70">
          Vote share = points received ÷ total points cast in scope. Same
          definition as the KPI Leaderboard so single-week and YTD numbers
          read consistently.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiTile
            icon={<ListChecks className="h-4 w-4" />}
            label="Total ballots"
            value={String(totalBallots)}
            hint="cast in scope"
          />
          <KpiTile
            icon={<Target className="h-4 w-4" />}
            label="Total points"
            value={NUMBER_FORMATTER.format(totalPoints)}
            hint="distributed firm-wide"
          />
          <KpiTile
            icon={<Crown className="h-4 w-4" />}
            label="Top scorer"
            value={topScorer ? topScorer.name : "—"}
            hint={
              topScorer
                ? `${NUMBER_FORMATTER.format(topScorer.total_points)} pts`
                : undefined
            }
            accent
          />
          <KpiTile
            icon={<Sparkles className="h-4 w-4" />}
            label="Top vote share"
            value={
              topScorer ? PERCENT_FORMATTER.format(topVoteShare) : "—"
            }
            hint={topScorer ? topScorer.name : undefined}
          />
        </div>

        <div className="overflow-x-auto rounded-md border border-[rgba(168,197,102,0.20)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[rgba(168,197,102,0.20)] text-[#F4EFE8]/70">
                <th className="text-left p-3 font-medium">Teammate</th>
                <th className="text-right p-3 font-medium">Points</th>
                <th className="text-right p-3 font-medium">Vote share</th>
                <th className="text-right p-3 font-medium hidden sm:table-cell">
                  Bar
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td
                    colSpan={4}
                    className="p-6 text-center text-[#F4EFE8]/60"
                  >
                    Loading weekly stats…
                  </td>
                </tr>
              )}
              {!loading && sortedByShare.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="p-6 text-center text-[#F4EFE8]/60"
                  >
                    No votes recorded for this period.
                  </td>
                </tr>
              )}
              {!loading &&
                sortedByShare.map((row) => {
                  const hero = findHeroProfile(row.name)
                  const share =
                    totalPoints > 0 ? row.total_points / totalPoints : 0
                  return (
                    <tr
                      key={row.name}
                      className="border-b border-[rgba(168,197,102,0.10)] hover:bg-[rgba(168,197,102,0.04)]"
                    >
                      <td className="p-3">
                        <div className="flex items-center gap-2.5 text-[#F4EFE8]">
                          <Avatar className="h-7 w-7">
                            {hero?.imageUrl && (
                              <AvatarImage
                                src={hero.imageUrl}
                                alt={row.name}
                              />
                            )}
                            <AvatarFallback className="text-[10px] bg-[#1D2620] text-[#A8C566]">
                              {getInitials(row.name)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium">{row.name}</span>
                        </div>
                      </td>
                      <td className="p-3 text-right tabular-nums text-[#F4EFE8]">
                        {NUMBER_FORMATTER.format(row.total_points)}
                      </td>
                      <td className="p-3 text-right tabular-nums text-[#A8C566] font-medium">
                        {PERCENT_FORMATTER.format(share)}
                      </td>
                      <td className="p-3 hidden sm:table-cell">
                        <div className="h-1.5 w-full rounded-full bg-[rgba(168,197,102,0.10)] overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.max(share * 100, share > 0 ? 2 : 0)}%`,
                              backgroundColor: "#A8C566",
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

function KpiTile({
  icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: React.ReactNode
  label: string
  value: string
  hint?: string
  accent?: boolean
}) {
  return (
    <div
      className="rounded-md border p-3 flex flex-col gap-1"
      style={{
        backgroundColor: accent ? "#A8C566" : "#1D2620",
        borderColor: accent ? "#8FAE4F" : "rgba(168,197,102,0.30)",
      }}
    >
      <div
        className="flex items-center justify-between text-xs uppercase tracking-wide"
        style={{ color: accent ? "#1D2620" : "rgba(244,239,232,0.75)" }}
      >
        <span>{label}</span>
        <span style={{ color: accent ? "#1D2620" : "#A8C566" }}>{icon}</span>
      </div>
      <div
        className="text-xl font-semibold tabular-nums leading-tight truncate"
        style={{ color: accent ? "#1D2620" : "#F4EFE8" }}
      >
        {value}
      </div>
      {hint && (
        <div
          className="text-xs truncate"
          style={{
            color: accent
              ? "rgba(29,38,32,0.75)"
              : "rgba(244,239,232,0.65)",
          }}
        >
          {hint}
        </div>
      )}
    </div>
  )
}
