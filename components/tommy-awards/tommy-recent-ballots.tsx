"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { FileText, ChevronDown, ChevronUp, Quote } from "lucide-react"
import { createClient } from "@/lib/supabase/client"

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
  submitted_at: string
}

export function TommyRecentBallots() {
  const [ballots, setBallots] = useState<Ballot[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedBallot, setExpandedBallot] = useState<string | null>(null)

  useEffect(() => {
    fetchBallots()
  }, [])

  const fetchBallots = async () => {
    const supabase = createClient()

    try {
      const { data, error } = await supabase
        .from("tommy_award_ballots")
        .select("*")
        .order("submitted_at", { ascending: false })
        .limit(20)

      if (error) throw error
      setBallots(data || [])
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
      hour: "numeric",
      minute: "2-digit",
    })
  }

  if (loading) {
    return (
      <Card className="border-border">
        <CardContent className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground"></div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-3 text-foreground">
          <div className="p-2 bg-blue-100 rounded-lg">
            <FileText className="h-5 w-5 text-blue-600" />
          </div>
          Recent Ballots
        </CardTitle>
        <CardDescription>Latest Tommy Award submissions from the team</CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[500px] pr-4">
          {ballots.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>No ballots submitted yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {ballots.map((ballot) => {
                const isExpanded = expandedBallot === ballot.id
                return (
                  <div
                    key={ballot.id}
                    className="p-4 rounded-xl border border-border bg-muted/30 transition-all hover:shadow-sm"
                  >
                    <button
                      onClick={() => setExpandedBallot(isExpanded ? null : ballot.id)}
                      className="w-full text-left"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-10 w-10">
                            <AvatarImage src="/placeholder.svg" alt={ballot.voter_name} />
                            <AvatarFallback className="bg-gradient-to-br from-blue-500 to-indigo-600 text-white font-semibold text-sm">
                              {getInitials(ballot.voter_name)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium text-foreground">{ballot.voter_name}</p>
                            <p className="text-xs text-muted-foreground">{formatDate(ballot.submitted_at)}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            1st: {ballot.first_place_name.split(" ")[0]}
                          </Badge>
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="mt-4 pt-4 border-t border-border space-y-3">
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
                        {ballot.honorable_mention_name && (
                          <VoteDetail
                            rank="HM"
                            name={ballot.honorable_mention_name}
                            notes={ballot.honorable_mention_notes || ""}
                            color="text-blue-600"
                          />
                        )}
                        {ballot.partner_vote_name && (
                          <VoteDetail
                            rank="Partner"
                            name={ballot.partner_vote_name}
                            notes={ballot.partner_vote_notes || ""}
                            color="text-emerald-600"
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
  return (
    <div className="flex gap-3">
      <Badge variant="outline" className={`${color} flex-shrink-0`}>
        {rank}
      </Badge>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-foreground text-sm">{name}</p>
        {notes && (
          <div className="mt-1 flex gap-2 text-sm text-muted-foreground">
            <Quote className="h-4 w-4 flex-shrink-0 mt-0.5 opacity-50" />
            <p className="italic">{notes}</p>
          </div>
        )}
      </div>
    </div>
  )
}
