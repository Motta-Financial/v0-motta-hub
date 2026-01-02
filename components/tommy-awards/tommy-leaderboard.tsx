"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Trophy, Medal, Award, Star, TrendingUp } from "lucide-react"
import { createClient } from "@/lib/supabase/client"

interface WeeklyPoints {
  id: string
  team_member_id: string
  team_member_name: string
  week_id: string
  week_date: string
  first_place_votes: number
  second_place_votes: number
  third_place_votes: number
  honorable_mention_votes: number
  partner_votes: number
  total_points: number
}

interface YearlyTotal {
  id: string
  team_member_id: string
  team_member_name: string
  year: number
  total_first_place_votes: number
  total_second_place_votes: number
  total_third_place_votes: number
  total_honorable_mention_votes: number
  total_partner_votes: number
  total_points: number
  weeks_participated: number
  current_rank: number
}

export function TommyLeaderboard() {
  const [weeklyPoints, setWeeklyPoints] = useState<WeeklyPoints[]>([])
  const [yearlyTotals, setYearlyTotals] = useState<YearlyTotal[]>([])
  const [loading, setLoading] = useState(true)
  const [currentWeekDate, setCurrentWeekDate] = useState<string | null>(null)

  useEffect(() => {
    fetchLeaderboardData()
  }, [])

  const fetchLeaderboardData = async () => {
    const supabase = createClient()

    try {
      // Get current/latest week
      const { data: latestWeek } = await supabase
        .from("tommy_award_weeks")
        .select("*")
        .order("week_date", { ascending: false })
        .limit(1)
        .single()

      if (latestWeek) {
        setCurrentWeekDate(latestWeek.week_date)

        // Get weekly points for current week
        const { data: weeklyData } = await supabase
          .from("tommy_award_points")
          .select("*")
          .eq("week_id", latestWeek.id)
          .order("total_points", { ascending: false })

        if (weeklyData) {
          setWeeklyPoints(weeklyData)
        }
      }

      // Get yearly totals
      const currentYear = new Date().getFullYear()
      const { data: yearlyData } = await supabase
        .from("tommy_award_yearly_totals")
        .select("*")
        .eq("year", currentYear)
        .order("total_points", { ascending: false })

      if (yearlyData) {
        setYearlyTotals(yearlyData)
      }
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
          <div className="p-2 bg-amber-100 rounded-lg">
            <Trophy className="h-5 w-5 text-amber-600" />
          </div>
          Tommy Awards Leaderboard
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="yearly" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger value="yearly" className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              {new Date().getFullYear()} Season
            </TabsTrigger>
            <TabsTrigger value="weekly" className="flex items-center gap-2">
              <Star className="h-4 w-4" />
              This Week
            </TabsTrigger>
          </TabsList>

          <TabsContent value="yearly" className="space-y-3">
            {yearlyTotals.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Trophy className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>No votes recorded yet this year</p>
              </div>
            ) : (
              yearlyTotals.map((entry, index) => (
                <div
                  key={entry.id}
                  className={`flex items-center gap-4 p-4 rounded-xl border transition-all hover:shadow-md ${getRankBg(index + 1)}`}
                >
                  <div className="w-10 flex justify-center">{getRankIcon(index + 1)}</div>
                  <Avatar className="h-12 w-12 border-2 border-white shadow-sm">
                    <AvatarImage src="/placeholder.svg" alt={entry.team_member_name} />
                    <AvatarFallback className="bg-gradient-to-br from-emerald-500 to-teal-600 text-white font-semibold">
                      {getInitials(entry.team_member_name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground truncate">{entry.team_member_name}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
                        {entry.total_first_place_votes} First
                      </Badge>
                      <Badge variant="outline" className="text-xs bg-slate-50 text-slate-600 border-slate-200">
                        {entry.total_second_place_votes} Second
                      </Badge>
                      <Badge variant="outline" className="text-xs bg-orange-50 text-orange-600 border-orange-200">
                        {entry.total_third_place_votes} Third
                      </Badge>
                      {entry.total_partner_votes > 0 && (
                        <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200">
                          {entry.total_partner_votes} Partner
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-foreground">{entry.total_points}</p>
                    <p className="text-xs text-muted-foreground">{entry.weeks_participated} weeks</p>
                  </div>
                </div>
              ))
            )}
          </TabsContent>

          <TabsContent value="weekly" className="space-y-3">
            {currentWeekDate && (
              <p className="text-sm text-muted-foreground mb-4">
                Week of{" "}
                {new Date(currentWeekDate).toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            )}
            {weeklyPoints.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Star className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>No votes this week yet</p>
              </div>
            ) : (
              weeklyPoints.map((entry, index) => (
                <div
                  key={entry.id}
                  className={`flex items-center gap-4 p-4 rounded-xl border transition-all hover:shadow-md ${getRankBg(index + 1)}`}
                >
                  <div className="w-10 flex justify-center">{getRankIcon(index + 1)}</div>
                  <Avatar className="h-12 w-12 border-2 border-white shadow-sm">
                    <AvatarImage src="/placeholder.svg" alt={entry.team_member_name} />
                    <AvatarFallback className="bg-gradient-to-br from-emerald-500 to-teal-600 text-white font-semibold">
                      {getInitials(entry.team_member_name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground truncate">{entry.team_member_name}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {entry.first_place_votes > 0 && (
                        <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
                          {entry.first_place_votes}x 1st
                        </Badge>
                      )}
                      {entry.second_place_votes > 0 && (
                        <Badge variant="outline" className="text-xs bg-slate-50 text-slate-600 border-slate-200">
                          {entry.second_place_votes}x 2nd
                        </Badge>
                      )}
                      {entry.third_place_votes > 0 && (
                        <Badge variant="outline" className="text-xs bg-orange-50 text-orange-600 border-orange-200">
                          {entry.third_place_votes}x 3rd
                        </Badge>
                      )}
                      {entry.honorable_mention_votes > 0 && (
                        <Badge variant="outline" className="text-xs">
                          {entry.honorable_mention_votes}x HM
                        </Badge>
                      )}
                      {entry.partner_votes > 0 && (
                        <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200">
                          {entry.partner_votes}x Partner
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-foreground">{entry.total_points}</p>
                    <p className="text-xs text-muted-foreground">points</p>
                  </div>
                </div>
              ))
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
