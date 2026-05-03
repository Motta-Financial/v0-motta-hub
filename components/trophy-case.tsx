"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Trophy, Medal, Award, Star, Crown, TrendingUp, Calendar, Sparkles, Loader2, MessageCircle, Quote } from "lucide-react"

interface TrophyCaseData {
  teamMember: { id: string; full_name: string | null }
  lifetime: {
    firstPlace: number
    secondPlace: number
    thirdPlace: number
    honorableMention: number
    partner: number
    totalPoints: number
    weeksPlaced: number
    weeksWon: number
    podiumWeeks: number
    bestRank: number | null
  }
  bestWeek: {
    weekDate: string
    points: number
    firstPlace: number
    secondPlace: number
    thirdPlace: number
    honorableMention: number
    partner: number
  } | null
  recentWeeks: Array<{
    weekDate: string
    points: number
    firstPlace: number
    secondPlace: number
    thirdPlace: number
    honorableMention: number
    partner: number
  }>
  yearly: Array<{
    year: number
    points: number
    rank: number | null
    weeksParticipated: number
    firstPlace: number
    secondPlace: number
    thirdPlace: number
    honorableMention: number
    partner: number
  }>
  feedbackReceived: Array<{
    id: string
    weekDate: string
    voterName: string
    placement: "1st" | "2nd" | "3rd" | "HM" | "Partner"
    notes: string | null
    submittedAt: string | null
  }>
}

function formatWeekDate(date: string) {
  // Render as "May 1, 2026" — week_date is a calendar date so we render
  // it in UTC to avoid the "off-by-one" issue when a user in PST loads
  // a date stored as midnight UTC.
  const d = new Date(`${date}T00:00:00Z`)
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"]
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

export function TrophyCase() {
  const [data, setData] = useState<TrophyCaseData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/profile/trophy-case")
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error || "Failed to load trophy case")
        return res.json()
      })
      .then((d: TrophyCaseData) => {
        if (!cancelled) setData(d)
      })
      .catch((e) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          {error || "No trophy case data available."}
        </CardContent>
      </Card>
    )
  }

  const { lifetime, bestWeek, recentWeeks, yearly, feedbackReceived } = data
  const hasAnyVotes =
    lifetime.firstPlace +
      lifetime.secondPlace +
      lifetime.thirdPlace +
      lifetime.honorableMention +
      lifetime.partner >
    0

  return (
    <div className="space-y-6">
      {/* Hero: lifetime headline stats. Mobile-first grid, 2 cols on
          phones and 4 on desktop so the four big numbers are scannable. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full bg-amber-100 p-3">
              <Trophy className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Weeks Won</p>
              <p className="text-2xl font-bold">{lifetime.weeksWon}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full bg-[#8E9B79]/20 p-3">
              <Star className="h-5 w-5 text-[#6B745D]" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Points</p>
              <p className="text-2xl font-bold">{lifetime.totalPoints}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full bg-blue-100 p-3">
              <Medal className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Podium Weeks</p>
              <p className="text-2xl font-bold">{lifetime.podiumWeeks}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full bg-orange-100 p-3">
              <Crown className="h-5 w-5 text-orange-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Best Rank</p>
              <p className="text-2xl font-bold">
                {lifetime.bestRank ? ordinal(lifetime.bestRank) : "—"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Empty state — show a single celebratory placeholder when the
          team member has never received a vote yet. Avoids rendering a
          page full of zeros. */}
      {!hasAnyVotes ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Sparkles className="h-10 w-10 mx-auto text-amber-500" />
            <h3 className="mt-4 text-lg font-semibold">No trophies yet</h3>
            <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
              Your trophy case is empty for now. Once teammates start
              recognizing your work in the weekly Tommy Awards, your wins
              will show up here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Vote breakdown — equally weighted by category, color-coded
              with the medal palette so the ranks are immediately legible. */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Award className="h-5 w-5 text-[#6B745D]" />
                Vote Breakdown
              </CardTitle>
              <CardDescription>
                All-time votes received across every week.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <VoteTile
                  label="1st Place"
                  count={lifetime.firstPlace}
                  icon={<Trophy className="h-4 w-4" />}
                  iconClass="text-amber-600 bg-amber-100"
                />
                <VoteTile
                  label="2nd Place"
                  count={lifetime.secondPlace}
                  icon={<Medal className="h-4 w-4" />}
                  iconClass="text-slate-600 bg-slate-100"
                />
                <VoteTile
                  label="3rd Place"
                  count={lifetime.thirdPlace}
                  icon={<Medal className="h-4 w-4" />}
                  iconClass="text-orange-700 bg-orange-100"
                />
                <VoteTile
                  label="Honorable Mention"
                  count={lifetime.honorableMention}
                  icon={<Star className="h-4 w-4" />}
                  iconClass="text-blue-600 bg-blue-100"
                />
                <VoteTile
                  label="Partner Vote"
                  count={lifetime.partner}
                  icon={<Crown className="h-4 w-4" />}
                  iconClass="text-[#6B745D] bg-[#8E9B79]/20"
                />
              </div>
            </CardContent>
          </Card>

          {/* Two-column layout: best week on the left, yearly history on
              the right. On mobile they stack. */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {bestWeek ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-[#6B745D]" />
                    Best Week
                  </CardTitle>
                  <CardDescription>Your highest-scoring week so far.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-baseline justify-between">
                    <div>
                      <p className="text-3xl font-bold text-[#6B745D]">
                        {bestWeek.points}
                        <span className="text-base font-normal text-muted-foreground ml-1">
                          pts
                        </span>
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Week of {formatWeekDate(bestWeek.weekDate)}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-4">
                    {bestWeek.firstPlace > 0 && (
                      <Badge variant="secondary" className="bg-amber-100 text-amber-800">
                        <Trophy className="h-3 w-3 mr-1" />
                        {bestWeek.firstPlace} × 1st
                      </Badge>
                    )}
                    {bestWeek.secondPlace > 0 && (
                      <Badge variant="secondary" className="bg-slate-100 text-slate-700">
                        {bestWeek.secondPlace} × 2nd
                      </Badge>
                    )}
                    {bestWeek.thirdPlace > 0 && (
                      <Badge variant="secondary" className="bg-orange-100 text-orange-800">
                        {bestWeek.thirdPlace} × 3rd
                      </Badge>
                    )}
                    {bestWeek.honorableMention > 0 && (
                      <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                        {bestWeek.honorableMention} × HM
                      </Badge>
                    )}
                    {bestWeek.partner > 0 && (
                      <Badge
                        variant="secondary"
                        className="bg-[#8E9B79]/20 text-[#6B745D]"
                      >
                        {bestWeek.partner} × Partner
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {yearly.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Calendar className="h-5 w-5 text-[#6B745D]" />
                    Yearly Tommy Points
                  </CardTitle>
                  <CardDescription>
                    Your standings and vote breakdown for each year.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {yearly.map((y) => (
                      <div
                        key={y.year}
                        className="rounded-lg border bg-muted/30 p-3"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="font-bold text-lg">{y.year}</span>
                            {y.rank && y.rank > 0 ? (
                              <Badge
                                variant="outline"
                                className={
                                  y.rank === 1
                                    ? "border-amber-300 bg-amber-50 text-amber-800"
                                    : y.rank === 2
                                      ? "border-slate-300 bg-slate-50 text-slate-700"
                                      : y.rank === 3
                                        ? "border-orange-300 bg-orange-50 text-orange-800"
                                        : ""
                                }
                              >
                                {y.rank === 1 && <Trophy className="h-3 w-3 mr-1" />}
                                {ordinal(y.rank)} place
                              </Badge>
                            ) : null}
                          </div>
                          <div className="text-right">
                            <p className="text-lg font-bold text-[#6B745D]">{y.points} pts</p>
                            <p className="text-xs text-muted-foreground">
                              {y.weeksParticipated}{" "}
                              {y.weeksParticipated === 1 ? "week" : "weeks"}
                            </p>
                          </div>
                        </div>
                        {/* Vote breakdown for this year */}
                        <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-border/50">
                          {y.firstPlace > 0 && (
                            <Badge variant="secondary" className="bg-amber-100 text-amber-800 text-xs">
                              <Trophy className="h-3 w-3 mr-1" />
                              {y.firstPlace} × 1st
                            </Badge>
                          )}
                          {y.secondPlace > 0 && (
                            <Badge variant="secondary" className="bg-slate-100 text-slate-700 text-xs">
                              {y.secondPlace} × 2nd
                            </Badge>
                          )}
                          {y.thirdPlace > 0 && (
                            <Badge variant="secondary" className="bg-orange-100 text-orange-800 text-xs">
                              {y.thirdPlace} × 3rd
                            </Badge>
                          )}
                          {y.honorableMention > 0 && (
                            <Badge variant="secondary" className="bg-blue-100 text-blue-800 text-xs">
                              {y.honorableMention} × HM
                            </Badge>
                          )}
                          {y.partner > 0 && (
                            <Badge variant="secondary" className="bg-[#8E9B79]/20 text-[#6B745D] text-xs">
                              {y.partner} × Partner
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>

          {recentWeeks.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5 text-[#6B745D]" />
                  Recent Weeks
                </CardTitle>
                <CardDescription>
                  Your last {recentWeeks.length} scoring weeks.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="divide-y">
                  {recentWeeks.map((w) => (
                    <div
                      key={w.weekDate}
                      className="flex items-center justify-between gap-4 py-3"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">
                          Week of {formatWeekDate(w.weekDate)}
                        </p>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {w.firstPlace > 0 && (
                            <Badge
                              variant="secondary"
                              className="bg-amber-100 text-amber-800 text-xs"
                            >
                              <Trophy className="h-3 w-3 mr-1" />
                              {w.firstPlace}
                            </Badge>
                          )}
                          {w.secondPlace > 0 && (
                            <Badge
                              variant="secondary"
                              className="bg-slate-100 text-slate-700 text-xs"
                            >
                              {w.secondPlace} × 2nd
                            </Badge>
                          )}
                          {w.thirdPlace > 0 && (
                            <Badge
                              variant="secondary"
                              className="bg-orange-100 text-orange-800 text-xs"
                            >
                              {w.thirdPlace} × 3rd
                            </Badge>
                          )}
                          {w.honorableMention > 0 && (
                            <Badge
                              variant="secondary"
                              className="bg-blue-100 text-blue-800 text-xs"
                            >
                              {w.honorableMention} × HM
                            </Badge>
                          )}
                          {w.partner > 0 && (
                            <Badge
                              variant="secondary"
                              className="bg-[#8E9B79]/20 text-[#6B745D] text-xs"
                            >
                              {w.partner} × Partner
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-lg font-bold text-[#6B745D]">{w.points}</p>
                        <p className="text-xs text-muted-foreground">pts</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {/* Feedback Received — notes from teammates who voted for you */}
          {feedbackReceived && feedbackReceived.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageCircle className="h-5 w-5 text-[#6B745D]" />
                  Feedback Received
                </CardTitle>
                <CardDescription>
                  Kind words from teammates who recognized your contributions.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {feedbackReceived.map((fb) => (
                    <div
                      key={fb.id}
                      className="rounded-lg border bg-gradient-to-br from-muted/30 to-muted/10 p-4"
                    >
                      <div className="flex items-start gap-3">
                        <div className="shrink-0 mt-1">
                          <Quote className="h-4 w-4 text-[#8E9B79]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground leading-relaxed">
                            {fb.notes}
                          </p>
                          <div className="flex flex-wrap items-center gap-2 mt-3">
                            <span className="text-xs text-muted-foreground">
                              {fb.voterName}
                            </span>
                            <span className="text-muted-foreground/50">·</span>
                            <span className="text-xs text-muted-foreground">
                              {formatWeekDate(fb.weekDate)}
                            </span>
                            <Badge
                              variant="secondary"
                              className={
                                fb.placement === "1st"
                                  ? "bg-amber-100 text-amber-800 text-xs"
                                  : fb.placement === "2nd"
                                    ? "bg-slate-100 text-slate-700 text-xs"
                                    : fb.placement === "3rd"
                                      ? "bg-orange-100 text-orange-800 text-xs"
                                      : fb.placement === "HM"
                                        ? "bg-blue-100 text-blue-800 text-xs"
                                        : "bg-[#8E9B79]/20 text-[#6B745D] text-xs"
                              }
                            >
                              {fb.placement === "1st" && (
                                <Trophy className="h-3 w-3 mr-1" />
                              )}
                              {fb.placement}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  )
}

function VoteTile({
  label,
  count,
  icon,
  iconClass,
}: {
  label: string
  count: number
  icon: React.ReactNode
  iconClass: string
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3 flex flex-col items-start gap-2">
      <div className={`rounded-full p-2 ${iconClass}`}>{icon}</div>
      <div>
        <p className="text-2xl font-bold leading-none">{count}</p>
        <p className="text-xs text-muted-foreground mt-1">{label}</p>
      </div>
    </div>
  )
}
