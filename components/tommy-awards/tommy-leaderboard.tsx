"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Trophy, Medal, Award, Sparkles, Lock, FileDown } from "lucide-react"
import { findHeroProfile } from "@/lib/motta-alliance/hero-profiles"
import { TommyMemberBreakdownDialog } from "./tommy-member-breakdown-dialog"

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

// Shape of the persisted Friday recap surfaced from
// `tommy_weekly_recaps` via /api/tommy-awards?type=weekly_recap. Only
// the fields the dashboard actually renders are typed here.
interface WeeklyRecap {
  week_id: string
  week_date: string
  week_label: string
  total_ballots: number
  ai_summary: string
  podium_image_url: string | null
  podium_pdf_url: string | null
  email_sent_at: string | null
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
  const [selectedMember, setSelectedMember] = useState<string | null>(null)
  // Weekly recap is rendered ONLY when exactly one week is selected —
  // the API enforces this too, but we mirror the condition here so we
  // don't show a stale recap from a previous filter state while a
  // wider filter is loading.
  const [recap, setRecap] = useState<WeeklyRecap | null>(null)
  // The selected week's `week_date` (Friday of that voting week) is
  // returned by the recap API independently of whether a recap row
  // exists yet. We use it below to decide whether the "Results
  // Sealed" waiting screen applies — pre-recap-system weeks have no
  // recap row but their standings should still be visible. See the
  // `isAwaitingRecap` comment below.
  const [selectedWeekDate, setSelectedWeekDate] = useState<string | null>(null)

  const is2026OrLater = filters.year !== "all" && Number.parseInt(filters.year) >= 2026
  // Once a single week is in scope we treat its recap as the source
  // of truth for the recap PANEL, but we ONLY seal the standings on
  // weeks that are still in flight. A week is "in flight" when its
  // Friday hasn't passed yet OR Friday has just arrived but the cron
  // hasn't shipped the recap email yet. Older weeks (pre-recap-system
  // and any week whose Friday + grace window has already passed) just
  // show their leaderboard, with the recap panel only rendering when
  // a recap row actually exists.
  //
  // Friday cutoff: the recap cron runs at 16:00 UTC (noon ET) on
  // Friday. We give a generous 24h grace window after the week_date
  // (which is itself the Friday) before un-sealing without a recap,
  // so a Friday-evening look-up doesn't reveal results before the
  // email lands but a Saturday or later look-up always does.
  const isSingleWeekView = filters.weekIds.length === 1
  const recapEmailSent = !!recap?.email_sent_at
  const isCurrentWeekStillSealed = (() => {
    if (!isSingleWeekView) return false
    if (recapEmailSent) return false
    if (!selectedWeekDate) return false
    const weekFriday = new Date(`${selectedWeekDate}T00:00:00Z`)
    // Reveal threshold = Friday end-of-day UTC (24h after the week_date
    // anchor). Past this point, even without a recap row, we show the
    // standings — that covers historical weeks that pre-date the
    // recap-row system.
    const revealThreshold = weekFriday.getTime() + 24 * 60 * 60 * 1000
    return Date.now() < revealThreshold
  })()
  const isAwaitingRecap = isCurrentWeekStillSealed
  // Show the recap panel whenever there's persisted content for the
  // selected week — `email_sent_at` only gates the "in-flight current
  // week" reveal (handled above by `isCurrentWeekStillSealed`). Once
  // a week is past its Friday cutoff, any backfilled `ai_summary`,
  // `podium_image_url`, or `podium_pdf_url` should render even if the
  // weekly email was never dispatched (e.g. the 21 historical 2026
  // weeks summarised retroactively for ALFRED's continuity context).
  const hasRecapContent =
    !!recap && (!!recap.ai_summary || !!recap.podium_image_url || !!recap.podium_pdf_url)
  const showRecap = isSingleWeekView && hasRecapContent && !isCurrentWeekStillSealed

  useEffect(() => {
    fetchLeaderboard()
  }, [filters])

  const fetchLeaderboard = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ type: "leaderboard" })
      if (filters.year && filters.year !== "all") params.append("year", filters.year)
      if (filters.weekIds.length > 0) params.append("week_ids", filters.weekIds.join(","))

      // Fetch the leaderboard and the (optional) weekly recap in
      // parallel. The recap endpoint short-circuits to `null` unless
      // exactly one week is selected, so this is a cheap call.
      const recapParams = new URLSearchParams({ type: "weekly_recap" })
      if (filters.weekIds.length > 0) recapParams.append("week_ids", filters.weekIds.join(","))

      const [lbRes, recapRes] = await Promise.all([
        fetch(`/api/tommy-awards?${params}`),
        fetch(`/api/tommy-awards?${recapParams}`),
      ])
      const lbData = await lbRes.json()
      const recapData = await recapRes.json().catch(() => ({ recap: null, week_date: null }))

      setLeaderboard(lbData.leaderboard || [])
      setTotalBallots(lbData.total_ballots || 0)
      setRecap(recapData?.recap ?? null)
      setSelectedWeekDate(recapData?.week_date ?? null)
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
      <CardContent className="space-y-5">
        {/* Friday recap panel — ALFRED's storyline + the generated
            F1-podium image for the selected week. Mirrors what gets
            emailed firm-wide so the dashboard is the single source of
            truth. Only renders when exactly one week is in scope. */}
        {showRecap && recap && (
          <div
            className="rounded-xl border-2 overflow-hidden"
            style={{
              borderColor: "rgba(168,197,102,0.30)",
              backgroundColor: "rgba(168,197,102,0.04)",
            }}
          >
            {recap.podium_image_url && (
              // gpt-image-2 renders this artwork at 1536×1024 (3:2).
              // The container mirrors that ratio EXACTLY so the image
              // fills edge-to-edge with no side-cropping — the prior
              // 16:9 box with `object-cover` was chopping the
              // "MOTTA ALLIANCE — TOMMY AWARDS" banner text on both
              // ends. `object-contain` is the belt-and-braces safety
              // net: even if a future render returns a different
              // aspect ratio, the dark backdrop letterboxes it instead
              // of clipping any artwork.
              <div className="relative w-full aspect-[3/2]" style={{ backgroundColor: "#0F140C" }}>
                <Image
                  src={recap.podium_image_url}
                  alt={`Generated podium image for ${recap.week_label}`}
                  fill
                  sizes="(max-width: 1024px) 100vw, 768px"
                  className="object-contain"
                  unoptimized
                />
              </div>
            )}
            <div className="p-4 sm:p-5 space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <div
                    className="p-1.5 rounded-md"
                    style={{ backgroundColor: "rgba(168,197,102,0.15)" }}
                  >
                    <Sparkles className="h-4 w-4" style={{ color: "#A8C566" }} />
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] font-bold" style={{ color: "#A8C566" }}>
                      ALFRED&apos;s Recap
                    </p>
                    <p className="text-sm font-semibold" style={{ color: "#F4EFE8" }}>
                      {recap.week_label}
                    </p>
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className="text-xs"
                  style={{
                    backgroundColor: "rgba(168,197,102,0.10)",
                    color: "#A8C566",
                    borderColor: "rgba(168,197,102,0.35)",
                  }}
                >
                  {recap.total_ballots} ballots
                </Badge>
              </div>
              {recap.ai_summary && (
                <p
                  className="text-sm leading-relaxed whitespace-pre-wrap"
                  style={{ color: "#E8E3DA" }}
                >
                  {recap.ai_summary}
                </p>
              )}
              {recap.podium_pdf_url && (
                <div className="pt-1">
                  <a
                    href={recap.podium_pdf_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors"
                    style={{
                      backgroundColor: "rgba(168,197,102,0.10)",
                      borderColor: "rgba(168,197,102,0.40)",
                      color: "#A8C566",
                    }}
                  >
                    <FileDown className="h-3.5 w-3.5" />
                    Download Dispatch PDF
                  </a>
                </div>
              )}
            </div>
          </div>
        )}

        {isAwaitingRecap ? (
          /* ALFRED "Results Sealed" waiting screen — the leaderboard
             standings stay hidden until the Friday recap email actually
             ships. We render the same dark-comic styling as the recap
             panel itself so the transition from "waiting" to "revealed"
             feels like one continuous storyline. The cron flips
             `email_sent_at` on the persisted recap row which causes this
             component to swap in the real leaderboard on its next
             refresh. */
          <div
            className="rounded-xl border-2 overflow-hidden"
            style={{
              borderColor: "rgba(168,197,102,0.30)",
              backgroundColor: "rgba(168,197,102,0.04)",
            }}
          >
            <div className="relative w-full aspect-[3/2]" style={{ backgroundColor: "#0F140C" }}>
              <Image
                src="/images/alfred-waiting.jpg"
                alt="ALFRED Ai standing by in the command center — Tommy Awards results sealed until the Friday recap drops"
                fill
                sizes="(max-width: 1024px) 100vw, 768px"
                className="object-cover"
                priority
              />
              <div
                className="absolute inset-0"
                style={{
                  backgroundImage:
                    "linear-gradient(to top, rgba(15,20,12,0.85) 0%, rgba(15,20,12,0.15) 50%, rgba(15,20,12,0.55) 100%)",
                }}
              />
              <div className="absolute inset-x-0 bottom-0 p-4 sm:p-5">
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className="p-1.5 rounded-md"
                    style={{ backgroundColor: "rgba(168,197,102,0.20)" }}
                  >
                    <Lock className="h-4 w-4" style={{ color: "#A8C566" }} />
                  </div>
                  <p className="text-xs uppercase tracking-[0.18em] font-bold" style={{ color: "#A8C566" }}>
                    Results Sealed
                  </p>
                </div>
                <p
                  className="font-sans text-2xl font-black uppercase italic tracking-tight"
                  style={{
                    color: "#F4EFE8",
                    textShadow: "0 2px 0 rgba(0,0,0,0.6)",
                  }}
                >
                  ALFRED is standing by
                </p>
              </div>
            </div>
            <div className="p-4 sm:p-5">
              <p className="text-sm leading-relaxed" style={{ color: "#E8E3DA" }}>
                Operation Tommy for{" "}
                <span style={{ color: "#A8C566", fontWeight: 600 }}>
                  {recap?.week_label || "this week"}
                </span>{" "}
                is still in motion. The podium, ALFRED&apos;s recap, and the
                generated dispatch PDF unlock the moment the Friday noon
                recap email ships to the firm. Check back after the
                dispatch hits your inbox.
              </p>
            </div>
          </div>
        ) : leaderboard.length === 0 ? (
          <div className="text-center py-8" style={{ color: "#B8B3AA" }}>
            <Trophy className="h-12 w-12 mx-auto mb-3 opacity-30" style={{ color: "#A8C566" }} />
            <p>No votes recorded for this period</p>
          </div>
        ) : (
          <div className="space-y-3">
            {leaderboard.map((entry) => {
              const hero = findHeroProfile(entry.name)
              return (
              <button
                key={entry.name}
                type="button"
                onClick={() => setSelectedMember(entry.name)}
                className="w-full text-left flex items-center gap-4 p-4 rounded-xl border-2 transition-all hover:shadow-lg hover:scale-[1.01] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#0F140C] cursor-pointer"
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
              </button>
              )
            })}
          </div>
        )}
      </CardContent>
      <TommyMemberBreakdownDialog
        open={selectedMember !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedMember(null)
        }}
        memberName={selectedMember}
        mode="weekly"
        year={filters.year}
        weekIds={filters.weekIds}
        periodLabel={getFilterDescription()}
      />
    </Card>
  )
}
