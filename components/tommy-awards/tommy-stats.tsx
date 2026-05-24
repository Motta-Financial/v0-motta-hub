"use client"

// Tommy Stats — start-date-aware KPIs.
//
// This view sits next to the Weekly and YTD tabs. The point is to surface
// fair, comparable metrics: percentages are always taken against a
// teammate's "eligible weeks" (= Tommy weeks that fell on or after their
// start_date and on or before today), so a teammate who joined in April
// isn't penalized for the weeks before they were here.

import { useEffect, useState } from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  ChevronUp,
  ChevronDown,
  Flame,
  Sparkles,
  Trophy,
  Calendar,
  Percent,
  Crown,
  TrendingUp,
  Target,
  Award,
} from "lucide-react"
import { findHeroProfile } from "@/lib/motta-alliance/hero-profiles"

interface TommyStatRow {
  name: string
  start_date: string | null
  eligible_weeks: number
  total_weeks_this_year: number
  weeks_voted_on: number
  podium_weeks: number
  podium_pct: number
  win_pct: number
  top2_pct: number
  vote_share_pct: number
  weeks_in_first: number
  weeks_in_second: number
  weeks_in_third: number
  first_place_votes: number
  second_place_votes: number
  third_place_votes: number
  honorable_mention_votes: number
  partner_votes: number
  total_points: number
  points_per_eligible_week: number
  avg_podium_finish: number | null
  current_streak: number
  best_streak: number
}

interface TommyStatsResponse {
  stats: TommyStatRow[]
  total_weeks_this_year: number
  year: string
  is_2026_or_later: boolean
}

type SortKey =
  | "podium_pct"
  | "win_pct"
  | "total_points"
  | "points_per_eligible_week"
  | "current_streak"
  | "best_streak"
  | "weeks_in_first"
  | "vote_share_pct"

interface TommyStatsProps {
  year: string
}

const NUMBER_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
})

const PERCENT_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 0,
})

const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
})

function formatStartDate(iso: string | null) {
  if (!iso) return "—"
  // Pin to noon UTC so locale rendering doesn't roll the date back a day.
  const d = new Date(`${iso}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return DATE_FORMATTER.format(d)
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

export function TommyStats({ year }: TommyStatsProps) {
  const [data, setData] = useState<TommyStatsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>("podium_pct")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const displayYear =
    year === "all" ? new Date().getFullYear().toString() : year

  useEffect(() => {
    let cancelled = false
    async function fetchStats() {
      setLoading(true)
      try {
        const params = new URLSearchParams({
          type: "tommy_stats",
          year: displayYear,
        })
        const res = await fetch(`/api/tommy-awards?${params}`)
        const json: TommyStatsResponse = await res.json()
        if (!cancelled) setData(json)
      } catch (err) {
        console.error("[v0] tommy_stats fetch failed:", err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchStats()
    return () => {
      cancelled = true
    }
  }, [displayYear])

  const stats = data?.stats || []

  const sortedStats = [...stats].sort((a, b) => {
    const av = (a[sortKey] as number) || 0
    const bv = (b[sortKey] as number) || 0
    return sortDir === "desc" ? bv - av : av - bv
  })

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(sortDir === "desc" ? "asc" : "desc")
    } else {
      setSortKey(key)
      setSortDir("desc")
    }
  }

  const totalWeeks = data?.total_weeks_this_year || 0
  const topPodium = stats[0]
  const topWinner = [...stats].sort(
    (a, b) => b.win_pct - a.win_pct || b.weeks_in_first - a.weeks_in_first,
  )[0]
  const bestStreak = [...stats].sort((a, b) => b.best_streak - a.best_streak)[0]

  return (
    <div className="space-y-4">
      <Card
        className="border"
        style={{
          // Solid forest fill so the section reads as a Tommy-branded
          // panel and isn't washed out by the cream page background.
          backgroundColor: "#0F140C",
          borderColor: "rgba(168,197,102,0.30)",
        }}
      >
        <CardHeader>
          <div className="flex flex-col gap-1.5">
            <CardTitle className="flex items-center gap-2 text-[#F4EFE8]">
              <Sparkles className="h-5 w-5" style={{ color: "#A8C566" }} />
              Tommy Stats — {displayYear}
            </CardTitle>
            <CardDescription className="text-[#F4EFE8]/70">
              KPIs are calculated against{" "}
              <span className="font-medium text-[#F4EFE8]">eligible weeks</span>{" "}
              — only Tommy weeks that fell on or after each teammate&apos;s
              start date are counted, so newer hires aren&apos;t penalized for
              weeks before they joined.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiTile
              icon={<Calendar className="h-4 w-4" />}
              label="Weeks tracked"
              value={String(totalWeeks)}
              hint={`in ${displayYear} so far`}
            />
            <KpiTile
              icon={<Percent className="h-4 w-4" />}
              label="Best podium %"
              value={
                topPodium ? PERCENT_FORMATTER.format(topPodium.podium_pct) : "—"
              }
              hint={topPodium ? topPodium.name : undefined}
              accent
            />
            <KpiTile
              icon={<Crown className="h-4 w-4" />}
              label="Most weekly wins"
              value={topWinner ? `${topWinner.weeks_in_first}` : "—"}
              hint={topWinner ? topWinner.name : undefined}
            />
            <KpiTile
              icon={<Flame className="h-4 w-4" />}
              label="Best podium streak"
              value={bestStreak ? `${bestStreak.best_streak} wks` : "—"}
              hint={bestStreak ? bestStreak.name : undefined}
            />
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="leaderboard" className="space-y-3">
        <TabsList
          className="w-full justify-start gap-1 p-1 h-auto"
          style={{
            backgroundColor: "#1D2620",
            borderColor: "rgba(168,197,102,0.30)",
          }}
        >
          <TabsTrigger
            value="leaderboard"
            className="data-[state=active]:bg-[#A8C566] data-[state=active]:text-[#1D2620] text-[#F4EFE8] hover:bg-[rgba(168,197,102,0.10)] gap-2"
          >
            <Trophy className="h-4 w-4" />
            KPI Leaderboard
          </TabsTrigger>
          <TabsTrigger
            value="cards"
            className="data-[state=active]:bg-[#A8C566] data-[state=active]:text-[#1D2620] text-[#F4EFE8] hover:bg-[rgba(168,197,102,0.10)] gap-2"
          >
            <Target className="h-4 w-4" />
            Per-teammate Cards
          </TabsTrigger>
        </TabsList>

        <TabsContent value="leaderboard" className="m-0">
          <Card
            style={{
              backgroundColor: "#0F140C",
              borderColor: "rgba(168,197,102,0.30)",
            }}
          >
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[rgba(168,197,102,0.20)] text-[#F4EFE8]/70">
                      <th className="text-left p-3 font-medium">Teammate</th>
                      <th className="text-left p-3 font-medium">Started</th>
                      <SortableHeader
                        label="Podium %"
                        active={sortKey === "podium_pct"}
                        dir={sortDir}
                        onClick={() => toggleSort("podium_pct")}
                      />
                      <SortableHeader
                        label="Win %"
                        active={sortKey === "win_pct"}
                        dir={sortDir}
                        onClick={() => toggleSort("win_pct")}
                      />
                      <SortableHeader
                        label="Pts / wk"
                        active={sortKey === "points_per_eligible_week"}
                        dir={sortDir}
                        onClick={() => toggleSort("points_per_eligible_week")}
                      />
                      <SortableHeader
                        label="Total pts"
                        active={sortKey === "total_points"}
                        dir={sortDir}
                        onClick={() => toggleSort("total_points")}
                      />
                      <SortableHeader
                        label="1st"
                        active={sortKey === "weeks_in_first"}
                        dir={sortDir}
                        onClick={() => toggleSort("weeks_in_first")}
                      />
                      <SortableHeader
                        label="Vote share"
                        active={sortKey === "vote_share_pct"}
                        dir={sortDir}
                        onClick={() => toggleSort("vote_share_pct")}
                      />
                      <SortableHeader
                        label="Streak"
                        active={sortKey === "current_streak"}
                        dir={sortDir}
                        onClick={() => toggleSort("current_streak")}
                      />
                      <SortableHeader
                        label="Best"
                        active={sortKey === "best_streak"}
                        dir={sortDir}
                        onClick={() => toggleSort("best_streak")}
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {loading && (
                      <tr>
                        <td
                          colSpan={10}
                          className="p-8 text-center text-[#F4EFE8]/60"
                        >
                          Loading Tommy Stats…
                        </td>
                      </tr>
                    )}
                    {!loading &&
                      sortedStats.map((row) => {
                        const hero = findHeroProfile(row.name)
                        return (
                          <tr
                            key={row.name}
                            className="border-b border-[rgba(168,197,102,0.10)] hover:bg-[rgba(168,197,102,0.04)] transition-colors"
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
                            <td className="p-3 text-[#F4EFE8]/70 text-xs">
                              <div className="flex flex-col leading-tight">
                                <span>{formatStartDate(row.start_date)}</span>
                                <span className="text-[10px] uppercase tracking-wide text-[#F4EFE8]/50">
                                  {row.eligible_weeks} eligible{" "}
                                  {row.eligible_weeks === 1 ? "wk" : "wks"}
                                </span>
                              </div>
                            </td>
                            <PercentCell
                              value={row.podium_pct}
                              numerator={row.podium_weeks}
                              denominator={row.eligible_weeks}
                              accent={sortKey === "podium_pct"}
                            />
                            <PercentCell
                              value={row.win_pct}
                              numerator={row.weeks_in_first}
                              denominator={row.eligible_weeks}
                              accent={sortKey === "win_pct"}
                            />
                            <td className="p-3 text-[#F4EFE8] text-right tabular-nums">
                              {NUMBER_FORMATTER.format(
                                row.points_per_eligible_week,
                              )}
                            </td>
                            <td className="p-3 text-[#F4EFE8] text-right tabular-nums">
                              {NUMBER_FORMATTER.format(row.total_points)}
                            </td>
                            <td className="p-3 text-[#F4EFE8] text-right tabular-nums">
                              {row.weeks_in_first}
                            </td>
                            <PercentCell
                              value={row.vote_share_pct}
                              numerator={row.weeks_voted_on}
                              denominator={row.eligible_weeks}
                              accent={sortKey === "vote_share_pct"}
                            />
                            <td className="p-3 text-right tabular-nums">
                              {row.current_streak > 0 ? (
                                <span className="inline-flex items-center gap-1 text-[#A8C566]">
                                  <Flame className="h-3.5 w-3.5" />
                                  {row.current_streak}
                                </span>
                              ) : (
                                <span className="text-[#F4EFE8]/40">0</span>
                              )}
                            </td>
                            <td className="p-3 text-[#F4EFE8] text-right tabular-nums">
                              {row.best_streak}
                            </td>
                          </tr>
                        )
                      })}
                    {!loading && sortedStats.length === 0 && (
                      <tr>
                        <td
                          colSpan={10}
                          className="p-8 text-center text-[#F4EFE8]/60"
                        >
                          No Tommy data yet for {displayYear}.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
          <p className="text-xs text-[#F4EFE8]/50 px-1 leading-relaxed">
            <span className="font-medium text-[#F4EFE8]/70">Eligible weeks</span>{" "}
            counts every Tommy week from a teammate&apos;s start date through
            today. Percentages divide by eligible weeks so a 4-podium / 4-week
            stretch reads as 100%, while a 17-podium / 23-week stretch reads as
            ~74%.{" "}
            <span className="font-medium text-[#F4EFE8]/70">Streak</span> is
            consecutive eligible weeks finishing on the podium.
          </p>
        </TabsContent>

        <TabsContent value="cards" className="m-0">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {loading && (
              <Card
                className="md:col-span-2 xl:col-span-3"
                style={{
                  backgroundColor: "#0F140C",
                  borderColor: "rgba(168,197,102,0.30)",
                }}
              >
                <CardContent className="p-8 text-center text-[#F4EFE8]/60">
                  Loading Tommy Stats…
                </CardContent>
              </Card>
            )}
            {!loading &&
              sortedStats.map((row) => <TeammateCard key={row.name} row={row} />)}
            {!loading && sortedStats.length === 0 && (
              <Card
                className="md:col-span-2 xl:col-span-3"
                style={{
                  backgroundColor: "#0F140C",
                  borderColor: "rgba(168,197,102,0.30)",
                }}
              >
                <CardContent className="p-8 text-center text-[#F4EFE8]/60">
                  No Tommy data yet for {displayYear}.
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
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
        // Solid surfaces so the tiles read cleanly regardless of whether
        // the parent page background is the dark forest or the cream
        // hub background. Translucent fills produce muddy olive when
        // layered over cream.
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
        className="text-2xl font-semibold tabular-nums leading-none"
        style={{ color: accent ? "#1D2620" : "#F4EFE8" }}
      >
        {value}
      </div>
      {hint && (
        <div
          className="text-xs truncate"
          style={{ color: accent ? "rgba(29,38,32,0.75)" : "rgba(244,239,232,0.65)" }}
        >
          {hint}
        </div>
      )}
    </div>
  )
}

function SortableHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string
  active: boolean
  dir: "asc" | "desc"
  onClick: () => void
}) {
  return (
    <th className="text-right p-3 font-medium">
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 hover:text-[#A8C566] transition-colors ${
          active ? "text-[#A8C566]" : "text-[#F4EFE8]/70"
        }`}
      >
        {label}
        {active &&
          (dir === "desc" ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5" />
          ))}
      </button>
    </th>
  )
}

function PercentCell({
  value,
  numerator,
  denominator,
  accent,
}: {
  value: number
  numerator: number
  denominator: number
  accent?: boolean
}) {
  return (
    <td className="p-3 text-right tabular-nums">
      <div
        className="font-medium"
        style={{ color: accent ? "#A8C566" : "#F4EFE8" }}
      >
        {PERCENT_FORMATTER.format(value)}
      </div>
      <div className="text-[10px] text-[#F4EFE8]/50">
        {numerator}/{denominator}
      </div>
    </td>
  )
}

function TeammateCard({ row }: { row: TommyStatRow }) {
  const hero = findHeroProfile(row.name)
  return (
    <Card
      style={{
        backgroundColor: "#0F140C",
        borderColor: "rgba(168,197,102,0.30)",
      }}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center gap-3">
          <Avatar className="h-12 w-12">
            {hero?.imageUrl && (
              <AvatarImage src={hero.imageUrl} alt={row.name} />
            )}
            <AvatarFallback className="bg-[#1D2620] text-[#A8C566] font-semibold">
              {getInitials(row.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base text-[#F4EFE8]">
              {row.name}
            </CardTitle>
            <CardDescription className="text-xs text-[#F4EFE8]/60">
              Started {formatStartDate(row.start_date)} · {row.eligible_weeks}{" "}
              eligible {row.eligible_weeks === 1 ? "week" : "weeks"}
            </CardDescription>
          </div>
          {row.current_streak >= 2 && (
            <Badge
              className="gap-1 text-[#1D2620]"
              style={{ backgroundColor: "#A8C566" }}
            >
              <Flame className="h-3 w-3" />
              {row.current_streak}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2 pt-2">
        <StatPill
          icon={<Percent className="h-3.5 w-3.5" />}
          label="Podium %"
          value={PERCENT_FORMATTER.format(row.podium_pct)}
          sub={`${row.podium_weeks}/${row.eligible_weeks} wks`}
          accent
        />
        <StatPill
          icon={<Crown className="h-3.5 w-3.5" />}
          label="Win %"
          value={PERCENT_FORMATTER.format(row.win_pct)}
          sub={`${row.weeks_in_first} wins`}
        />
        <StatPill
          icon={<Trophy className="h-3.5 w-3.5" />}
          label="Total points"
          value={NUMBER_FORMATTER.format(row.total_points)}
          sub={`${NUMBER_FORMATTER.format(row.points_per_eligible_week)} / wk`}
        />
        <StatPill
          icon={<Award className="h-3.5 w-3.5" />}
          label="Best streak"
          value={`${row.best_streak} wks`}
          sub={
            row.current_streak > 0
              ? `Active: ${row.current_streak}`
              : "Not active"
          }
        />
        <StatPill
          icon={<TrendingUp className="h-3.5 w-3.5" />}
          label="Avg podium finish"
          value={
            row.avg_podium_finish !== null
              ? row.avg_podium_finish.toFixed(2)
              : "—"
          }
          sub="when honored"
        />
        <StatPill
          icon={<Target className="h-3.5 w-3.5" />}
          label="Vote share"
          value={PERCENT_FORMATTER.format(row.vote_share_pct)}
          sub={`${row.weeks_voted_on}/${row.eligible_weeks} wks voted on`}
        />
      </CardContent>
    </Card>
  )
}

function StatPill({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  accent?: boolean
}) {
  return (
    <div
      className="rounded-md p-2 flex flex-col gap-0.5 border"
      style={{
        backgroundColor: accent ? "rgba(168,197,102,0.18)" : "#1D2620",
        borderColor: accent
          ? "rgba(168,197,102,0.50)"
          : "rgba(168,197,102,0.20)",
      }}
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[#F4EFE8]/65">
        <span style={{ color: accent ? "#A8C566" : "rgba(244,239,232,0.55)" }}>
          {icon}
        </span>
        {label}
      </div>
      <div
        className="text-lg font-semibold tabular-nums leading-none"
        style={{ color: accent ? "#A8C566" : "#F4EFE8" }}
      >
        {value}
      </div>
      {sub && <div className="text-[10px] text-[#F4EFE8]/55 truncate">{sub}</div>}
    </div>
  )
}
