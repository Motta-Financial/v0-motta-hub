"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { FileText, ChevronDown, ChevronUp, Quote, Calendar } from "lucide-react"
import { findHeroProfile } from "@/lib/motta-alliance/hero-profiles"

interface Ballot {
  id: string
  voter_name: string
  week_date: string
  first_place_name: string
  first_place_notes: string
  second_place_name: string
  second_place_notes: string
  third_place_name: string
  third_place_notes: string
  honorable_mention_name: string | null
  honorable_mention_notes: string | null
  partner_vote_name: string | null
  partner_vote_notes: string | null
  created_at: string
  week?: {
    id: string
    week_date: string
    week_name: string
  }
}

interface Filters {
  year: string
  weekIds: string[]
  teamMemberId: string
}

interface TommyRecentBallotsProps {
  filters: Filters
}

export function TommyRecentBallots({ filters }: TommyRecentBallotsProps) {
  const [ballots, setBallots] = useState<Ballot[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedBallot, setExpandedBallot] = useState<string | null>(null)

  useEffect(() => {
    fetchBallots()
  }, [filters])

  const fetchBallots = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ type: "ballots" })
      if (filters.year && filters.year !== "all") params.append("year", filters.year)
      if (filters.weekIds.length > 0) params.append("week_ids", filters.weekIds.join(","))
      if (filters.teamMemberId && filters.teamMemberId !== "all") params.append("team_member_id", filters.teamMemberId)

      const res = await fetch(`/api/tommy-awards?${params}`)
      const data = await res.json()

      setBallots(data.ballots || [])
    } catch (err) {
      console.error("Error fetching ballots:", err)
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

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  }

  const isBallot2026OrLater = (ballot: Ballot) => {
    const year = Number.parseInt(ballot.week_date.substring(0, 4))
    return year >= 2026
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
              <FileText className="h-5 w-5" style={{ color: "#A8C566" }} />
            </div>
            Ballots
          </CardTitle>
          <Badge
            variant="outline"
            style={{
              backgroundColor: "rgba(168,197,102,0.10)",
              color: "#A8C566",
              borderColor: "rgba(168,197,102,0.35)",
            }}
          >
            {ballots.length} ballots
          </Badge>
        </div>
        <CardDescription style={{ color: "#B8B3AA" }}>Tommy Award submissions from the team</CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[500px] pr-4">
          {ballots.length === 0 ? (
            <div className="text-center py-8" style={{ color: "#B8B3AA" }}>
              <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" style={{ color: "#A8C566" }} />
              <p>No ballots found for this filter</p>
            </div>
          ) : (
            <div className="space-y-3">
              {ballots.map((ballot) => {
                const isExpanded = expandedBallot === ballot.id
                const is2026Ballot = isBallot2026OrLater(ballot)
                const voterHero = findHeroProfile(ballot.voter_name)
                return (
                  <div
                    key={ballot.id}
                    className="p-4 rounded-xl border-2 transition-all hover:shadow-lg"
                    style={{
                      backgroundColor: "rgba(168,197,102,0.04)",
                      borderColor: "rgba(168,197,102,0.20)",
                    }}
                  >
                    <button
                      onClick={() => setExpandedBallot(isExpanded ? null : ballot.id)}
                      className="w-full text-left"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Avatar
                            className="h-10 w-10 border-2"
                            style={{ borderColor: "rgba(168,197,102,0.25)" }}
                            title={voterHero ? `${voterHero.name} — ${voterHero.alias}` : ballot.voter_name}
                          >
                            <AvatarImage
                              src={voterHero?.imageUrl || "/placeholder.svg"}
                              alt={voterHero ? `${ballot.voter_name} — ${voterHero.alias}` : ballot.voter_name}
                              className="object-cover object-top"
                            />
                            <AvatarFallback
                              className="font-semibold text-sm"
                              style={{
                                background: "linear-gradient(135deg, #0F140C, #1a1f15)",
                                color: "#A8C566",
                              }}
                            >
                              {getInitials(ballot.voter_name)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium" style={{ color: "#F4EFE8" }}>{ballot.voter_name}</p>
                            <div className="flex items-center gap-1 text-xs" style={{ color: "#B8B3AA" }}>
                              <Calendar className="h-3 w-3" />
                              {ballot.week?.week_name || formatDate(ballot.week_date)}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className="text-xs"
                            style={{
                              backgroundColor: "rgba(230,168,92,0.12)",
                              color: "#E6A85C",
                              borderColor: "rgba(230,168,92,0.35)",
                            }}
                          >
                            1st: {ballot.first_place_name?.split(" ")[0]}
                          </Badge>
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4" style={{ color: "#B8B3AA" }} />
                          ) : (
                            <ChevronDown className="h-4 w-4" style={{ color: "#B8B3AA" }} />
                          )}
                        </div>
                      </div>
                    </button>

                    {isExpanded && (
                      <div
                        className="mt-4 pt-4 border-t space-y-3"
                        style={{ borderColor: "rgba(168,197,102,0.20)" }}
                      >
                        {!is2026Ballot && ballot.partner_vote_name && (
                          <VoteDetail
                            rank="Partner"
                            name={ballot.partner_vote_name}
                            notes={ballot.partner_vote_notes || ""}
                            color="text-emerald-600"
                          />
                        )}
                        <VoteDetail
                          rank="1st"
                          name={ballot.first_place_name}
                          notes={ballot.first_place_notes}
                          color="text-amber-600"
                        />
                        <VoteDetail
                          rank="2nd"
                          name={ballot.second_place_name}
                          notes={ballot.second_place_notes}
                          color="text-slate-500"
                        />
                        <VoteDetail
                          rank="3rd"
                          name={ballot.third_place_name}
                          notes={ballot.third_place_notes}
                          color="text-orange-600"
                        />
                        {!is2026Ballot && ballot.honorable_mention_name && (
                          <VoteDetail
                            rank="HM"
                            name={ballot.honorable_mention_name}
                            notes={ballot.honorable_mention_notes || ""}
                            color="text-blue-600"
                          />
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

function VoteDetail({
  rank,
  name,
  notes,
  color,
}: {
  rank: string
  name: string
  notes: string
  color: string
}) {
  // Map color to Motta Alliance palette
  const badgeStyle = color.includes("amber")
    ? { backgroundColor: "rgba(230,168,92,0.15)", color: "#E6A85C", borderColor: "rgba(230,168,92,0.40)" }
    : color.includes("slate")
      ? { backgroundColor: "rgba(168,197,102,0.10)", color: "#A8C566", borderColor: "rgba(168,197,102,0.35)" }
      : color.includes("orange")
        ? { backgroundColor: "rgba(230,168,92,0.12)", color: "#E6A85C", borderColor: "rgba(230,168,92,0.30)" }
        : color.includes("emerald")
          ? { backgroundColor: "rgba(168,197,102,0.12)", color: "#A8C566", borderColor: "rgba(168,197,102,0.35)" }
          : { backgroundColor: "rgba(168,197,102,0.08)", color: "#B8B3AA", borderColor: "rgba(168,197,102,0.25)" }

  return (
    <div className="flex gap-3">
      <Badge variant="outline" className="flex-shrink-0" style={badgeStyle}>
        {rank}
      </Badge>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm" style={{ color: "#F4EFE8" }}>{name}</p>
        {notes && (
          <div className="mt-1 flex gap-2 text-sm" style={{ color: "#B8B3AA" }}>
            <Quote className="h-4 w-4 flex-shrink-0 mt-0.5 opacity-50" style={{ color: "#A8C566" }} />
            <p className="italic">{notes}</p>
          </div>
        )}
      </div>
    </div>
  )
}
