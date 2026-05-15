"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Award, ExternalLink, Medal, Trophy, Calendar } from "lucide-react"
import { findHeroProfile } from "@/lib/motta-alliance/hero-profiles"

interface BaseProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  memberName: string | null
}

interface WeeklyProps extends BaseProps {
  mode: "weekly"
  year: string
  weekIds: string[]
  /** Human-readable label like "Week of Nov 3" or "2 Weeks" for context. */
  periodLabel: string
}

interface YTDProps extends BaseProps {
  mode: "ytd"
  year: string
}

type Props = WeeklyProps | YTDProps

interface WeeklyVote {
  voter: string
  week_date: string
}

interface WeeklyData {
  mode: "weekly"
  name: string
  total_points: number
  total_ballots: number
  votes: {
    first: WeeklyVote[]
    second: WeeklyVote[]
    third: WeeklyVote[]
    hm: WeeklyVote[]
    partner: WeeklyVote[]
  }
  is_2026_or_later: boolean
}

interface YTDWeekRow {
  week_date: string
  points: number
  finish: number | null
  first_place_votes: number
  second_place_votes: number
  third_place_votes: number
  hm_votes: number
  partner_votes: number
}

interface YTDData {
  mode: "ytd"
  name: string
  year: string
  total_points: number
  first_place_votes: number
  second_place_votes: number
  third_place_votes: number
  hm_votes: number
  partner_votes: number
  weeks_in_first: number
  weeks_in_second: number
  weeks_in_third: number
  weeks_participated: number
  week_rows: YTDWeekRow[]
  is_2026_or_later: boolean
}

const ACCENT = "#A8C566"
const AMBER = "#E6A85C"
const INK = "#F4EFE8"
const MUTED = "#B8B3AA"
const SURFACE = "#0F140C"
const BORDER = "rgba(168,197,102,0.25)"

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

function formatWeekDate(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00`)
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function PlaceIcon({ place }: { place: 1 | 2 | 3 }) {
  if (place === 1) return <Trophy className="h-4 w-4" style={{ color: AMBER }} />
  if (place === 2) return <Medal className="h-4 w-4" style={{ color: ACCENT }} />
  return <Award className="h-4 w-4" style={{ color: AMBER }} />
}

export function TommyMemberBreakdownDialog(props: Props) {
  const { open, onOpenChange, memberName, mode } = props
  const [loading, setLoading] = useState(false)
  const [weeklyData, setWeeklyData] = useState<WeeklyData | null>(null)
  const [ytdData, setYtdData] = useState<YTDData | null>(null)

  const hero = memberName ? findHeroProfile(memberName) : null

  useEffect(() => {
    if (!open || !memberName) return
    let cancelled = false
    const run = async () => {
      setLoading(true)
      setWeeklyData(null)
      setYtdData(null)
      try {
        const params = new URLSearchParams({
          type: "member_breakdown",
          name: memberName,
          mode,
        })
        if (props.year && props.year !== "all") params.append("year", props.year)
        if (mode === "weekly" && props.weekIds.length > 0) {
          params.append("week_ids", props.weekIds.join(","))
        }
        const res = await fetch(`/api/tommy-awards?${params}`)
        const data = await res.json()
        if (cancelled) return
        if (mode === "weekly") setWeeklyData(data)
        else setYtdData(data)
      } catch (e) {
        console.error("[v0] member breakdown fetch failed:", e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, memberName, mode, props.year, mode === "weekly" ? props.weekIds.join(",") : ""])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl max-h-[85vh] overflow-y-auto border-2"
        style={{ backgroundColor: SURFACE, borderColor: BORDER, color: INK }}
      >
        <DialogHeader>
          <div className="flex items-center gap-4">
            <Avatar
              className="h-14 w-14 border-2 shadow-md flex-shrink-0"
              style={{ borderColor: "rgba(168,197,102,0.40)" }}
            >
              <AvatarImage
                src={hero?.imageUrl || "/placeholder.svg"}
                alt={hero ? `${memberName} — ${hero.alias}` : memberName ?? ""}
                className="object-cover object-top"
              />
              <AvatarFallback
                className="font-semibold"
                style={{
                  background: "linear-gradient(135deg, #0F140C, #1a1f15)",
                  color: ACCENT,
                }}
              >
                {memberName ? getInitials(memberName) : "?"}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <DialogTitle style={{ color: INK }}>{memberName}</DialogTitle>
              {hero && (
                <DialogDescription className="mt-0.5" style={{ color: MUTED }}>
                  {hero.alias}
                </DialogDescription>
              )}
              {hero ? (
                <Link
                  href={`/motta-alliance#${hero.slug}`}
                  className="inline-flex items-center gap-1 mt-1 text-xs font-medium hover:underline"
                  style={{ color: ACCENT }}
                >
                  View Motta Alliance profile
                  <ExternalLink className="h-3 w-3" />
                </Link>
              ) : (
                <Link
                  href="/motta-alliance"
                  className="inline-flex items-center gap-1 mt-1 text-xs font-medium hover:underline"
                  style={{ color: ACCENT }}
                >
                  Visit Motta Alliance
                  <ExternalLink className="h-3 w-3" />
                </Link>
              )}
            </div>
          </div>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <div
              className="animate-spin rounded-full h-8 w-8 border-b-2"
              style={{ borderColor: ACCENT }}
            />
          </div>
        )}

        {!loading && mode === "weekly" && weeklyData && (
          <WeeklyBody data={weeklyData} periodLabel={(props as WeeklyProps).periodLabel} />
        )}

        {!loading && mode === "ytd" && ytdData && <YTDBody data={ytdData} />}
      </DialogContent>
    </Dialog>
  )
}

function StatPill({
  label,
  value,
  color = ACCENT,
}: {
  label: string
  value: number | string
  color?: string
}) {
  return (
    <div
      className="rounded-lg border-2 px-3 py-2 flex flex-col"
      style={{
        backgroundColor: "rgba(168,197,102,0.05)",
        borderColor: "rgba(168,197,102,0.20)",
      }}
    >
      <span className="text-2xl font-bold leading-none" style={{ color }}>
        {value}
      </span>
      <span className="text-[11px] uppercase tracking-wide mt-1" style={{ color: MUTED }}>
        {label}
      </span>
    </div>
  )
}

function VoteSection({
  place,
  label,
  votes,
  pointsEach,
}: {
  place: 1 | 2 | 3 | "hm" | "partner"
  label: string
  votes: WeeklyVote[]
  pointsEach: number
}) {
  if (votes.length === 0) return null
  return (
    <div
      className="rounded-lg border-2 p-3"
      style={{
        backgroundColor: "rgba(168,197,102,0.04)",
        borderColor: "rgba(168,197,102,0.18)",
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {(place === 1 || place === 2 || place === 3) && <PlaceIcon place={place} />}
          <span className="font-semibold text-sm" style={{ color: INK }}>
            {label}
          </span>
          <Badge
            variant="outline"
            className="text-xs"
            style={{
              backgroundColor: "rgba(168,197,102,0.10)",
              color: ACCENT,
              borderColor: "rgba(168,197,102,0.35)",
            }}
          >
            {votes.length} × {pointsEach} pt{pointsEach === 1 ? "" : "s"} = {(votes.length * pointsEach).toFixed(votes.length * pointsEach % 1 ? 1 : 0)} pts
          </Badge>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {votes.map((v, i) => (
          <Badge
            key={`${v.voter}-${v.week_date}-${i}`}
            variant="outline"
            className="text-xs font-normal"
            style={{
              backgroundColor: "rgba(244,239,232,0.04)",
              color: INK,
              borderColor: "rgba(168,197,102,0.20)",
            }}
            title={`Voted ${formatWeekDate(v.week_date)}`}
          >
            {v.voter}
          </Badge>
        ))}
      </div>
    </div>
  )
}

function WeeklyBody({ data, periodLabel }: { data: WeeklyData; periodLabel: string }) {
  const { votes, total_points, total_ballots, is_2026_or_later } = data
  const totalVotes =
    votes.first.length +
    votes.second.length +
    votes.third.length +
    votes.hm.length +
    votes.partner.length

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap text-xs" style={{ color: MUTED }}>
        <Calendar className="h-3.5 w-3.5" style={{ color: ACCENT }} />
        <span>{periodLabel}</span>
        <span>·</span>
        <span>{total_ballots} ballots cast</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <StatPill label="Total points" value={total_points} />
        <StatPill label="Votes received" value={totalVotes} />
        <StatPill label="1st place" value={votes.first.length} color={AMBER} />
      </div>

      {totalVotes === 0 ? (
        <div
          className="text-center py-8 rounded-lg border-2 border-dashed"
          style={{ borderColor: "rgba(168,197,102,0.20)", color: MUTED }}
        >
          No votes received in this period.
        </div>
      ) : (
        <div className="space-y-2">
          <VoteSection place={1} label="1st place" votes={votes.first} pointsEach={3} />
          <VoteSection place={2} label="2nd place" votes={votes.second} pointsEach={2} />
          <VoteSection place={3} label="3rd place" votes={votes.third} pointsEach={1} />
          {!is_2026_or_later && (
            <>
              <VoteSection place="hm" label="Honorable mention" votes={votes.hm} pointsEach={0.5} />
              <VoteSection place="partner" label="Partner vote" votes={votes.partner} pointsEach={5} />
            </>
          )}
        </div>
      )}
    </div>
  )
}

function YTDBody({ data }: { data: YTDData }) {
  const { week_rows, year, is_2026_or_later } = data

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatPill label={`${year} points`} value={data.total_points} />
        <StatPill label="Weeks scored" value={data.weeks_participated} />
        <StatPill label="Weekly wins" value={data.weeks_in_first} color={AMBER} />
        <StatPill label="Podium weeks" value={data.weeks_in_first + data.weeks_in_second + data.weeks_in_third} />
      </div>

      <div
        className="grid grid-cols-3 sm:grid-cols-5 gap-2 rounded-lg border-2 p-3"
        style={{
          backgroundColor: "rgba(168,197,102,0.04)",
          borderColor: "rgba(168,197,102,0.18)",
        }}
      >
        <div className="flex flex-col">
          <span className="text-lg font-bold" style={{ color: INK }}>
            {data.first_place_votes}
          </span>
          <span className="text-[11px] uppercase tracking-wide" style={{ color: MUTED }}>
            1st-place votes
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-lg font-bold" style={{ color: INK }}>
            {data.second_place_votes}
          </span>
          <span className="text-[11px] uppercase tracking-wide" style={{ color: MUTED }}>
            2nd-place votes
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-lg font-bold" style={{ color: INK }}>
            {data.third_place_votes}
          </span>
          <span className="text-[11px] uppercase tracking-wide" style={{ color: MUTED }}>
            3rd-place votes
          </span>
        </div>
        {!is_2026_or_later && (
          <>
            <div className="flex flex-col">
              <span className="text-lg font-bold" style={{ color: INK }}>
                {data.hm_votes}
              </span>
              <span className="text-[11px] uppercase tracking-wide" style={{ color: MUTED }}>
                Honorable mention
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-lg font-bold" style={{ color: INK }}>
                {data.partner_votes}
              </span>
              <span className="text-[11px] uppercase tracking-wide" style={{ color: MUTED }}>
                Partner votes
              </span>
            </div>
          </>
        )}
      </div>

      {week_rows.length === 0 ? (
        <div
          className="text-center py-8 rounded-lg border-2 border-dashed"
          style={{ borderColor: "rgba(168,197,102,0.20)", color: MUTED }}
        >
          No votes received in {year} yet.
        </div>
      ) : (
        <div className="space-y-1.5">
          <div
            className="text-xs font-medium uppercase tracking-wide pb-1"
            style={{ color: MUTED }}
          >
            Week-by-week
          </div>
          {week_rows.map((row) => (
            <div
              key={row.week_date}
              className="flex items-center gap-3 rounded-lg border px-3 py-2"
              style={{
                backgroundColor:
                  row.finish === 1
                    ? "rgba(230,168,92,0.10)"
                    : row.finish === 2
                      ? "rgba(168,197,102,0.06)"
                      : row.finish === 3
                        ? "rgba(230,168,92,0.05)"
                        : "rgba(168,197,102,0.03)",
                borderColor:
                  row.finish === 1
                    ? "rgba(230,168,92,0.30)"
                    : row.finish === 2
                      ? "rgba(168,197,102,0.22)"
                      : row.finish === 3
                        ? "rgba(230,168,92,0.18)"
                        : "rgba(168,197,102,0.12)",
              }}
            >
              <div className="w-7 flex-shrink-0 flex justify-center">
                {row.finish === 1 || row.finish === 2 || row.finish === 3 ? (
                  <PlaceIcon place={row.finish} />
                ) : (
                  <span className="text-xs font-bold" style={{ color: MUTED }}>
                    —
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium" style={{ color: INK }}>
                  Week of {formatWeekDate(row.week_date)}
                </p>
                <div className="flex flex-wrap gap-x-2 text-[11px]" style={{ color: MUTED }}>
                  {row.first_place_votes > 0 && (
                    <span>
                      <strong style={{ color: INK }}>{row.first_place_votes}</strong> 1st
                    </span>
                  )}
                  {row.second_place_votes > 0 && (
                    <span>
                      <strong style={{ color: INK }}>{row.second_place_votes}</strong> 2nd
                    </span>
                  )}
                  {row.third_place_votes > 0 && (
                    <span>
                      <strong style={{ color: INK }}>{row.third_place_votes}</strong> 3rd
                    </span>
                  )}
                  {!is_2026_or_later && row.hm_votes > 0 && (
                    <span>
                      <strong style={{ color: INK }}>{row.hm_votes}</strong> HM
                    </span>
                  )}
                  {!is_2026_or_later && row.partner_votes > 0 && (
                    <span>
                      <strong style={{ color: INK }}>{row.partner_votes}</strong> partner
                    </span>
                  )}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-base font-bold leading-none" style={{ color: INK }}>
                  {row.points}
                </p>
                <p className="text-[10px] uppercase tracking-wide" style={{ color: MUTED }}>
                  pts
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
