import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const searchParams = request.nextUrl.searchParams

  const year = searchParams.get("year")
  const weekId = searchParams.get("week_id")
  const teamMemberId = searchParams.get("team_member_id")
  const voterName = searchParams.get("voter_name")
  const type = searchParams.get("type") || "ballots" // ballots, weeks, leaderboard, team_members

  try {
    // Get weeks for filter dropdown
    if (type === "weeks") {
      let query = supabase.from("tommy_award_weeks").select("*").order("week_date", { ascending: false })

      if (year) {
        const startDate = `${year}-01-01`
        const endDate = `${year}-12-31`
        query = query.gte("week_date", startDate).lte("week_date", endDate)
      }

      const { data, error } = await query

      if (error) throw error
      return NextResponse.json({ weeks: data })
    }

    // Get team members for filter dropdown
    if (type === "team_members") {
      const { data, error } = await supabase
        .from("team_members")
        .select("id, full_name, first_name, last_name, is_active")
        .order("full_name")

      if (error) throw error
      return NextResponse.json({ team_members: data })
    }

    // Get leaderboard data
    if (type === "leaderboard") {
      // Calculate points from ballots
      let ballotsQuery = supabase.from("tommy_award_ballots").select("*")

      if (year) {
        const startDate = `${year}-01-01`
        const endDate = `${year}-12-31`
        ballotsQuery = ballotsQuery.gte("week_date", startDate).lte("week_date", endDate)
      }

      if (weekId) {
        ballotsQuery = ballotsQuery.eq("week_id", weekId)
      }

      const { data: ballots, error } = await ballotsQuery

      if (error) throw error

      // Calculate points per team member
      const pointsMap: Record<
        string,
        {
          name: string
          first_place_votes: number
          second_place_votes: number
          third_place_votes: number
          honorable_mention_votes: number
          partner_votes: number
          total_points: number
        }
      > = {}

      ballots?.forEach((ballot) => {
        // First place: 3 points
        if (ballot.first_place_name) {
          if (!pointsMap[ballot.first_place_name]) {
            pointsMap[ballot.first_place_name] = {
              name: ballot.first_place_name,
              first_place_votes: 0,
              second_place_votes: 0,
              third_place_votes: 0,
              honorable_mention_votes: 0,
              partner_votes: 0,
              total_points: 0,
            }
          }
          pointsMap[ballot.first_place_name].first_place_votes++
          pointsMap[ballot.first_place_name].total_points += 3
        }

        // Second place: 2 points
        if (ballot.second_place_name) {
          if (!pointsMap[ballot.second_place_name]) {
            pointsMap[ballot.second_place_name] = {
              name: ballot.second_place_name,
              first_place_votes: 0,
              second_place_votes: 0,
              third_place_votes: 0,
              honorable_mention_votes: 0,
              partner_votes: 0,
              total_points: 0,
            }
          }
          pointsMap[ballot.second_place_name].second_place_votes++
          pointsMap[ballot.second_place_name].total_points += 2
        }

        // Third place: 1 point
        if (ballot.third_place_name) {
          if (!pointsMap[ballot.third_place_name]) {
            pointsMap[ballot.third_place_name] = {
              name: ballot.third_place_name,
              first_place_votes: 0,
              second_place_votes: 0,
              third_place_votes: 0,
              honorable_mention_votes: 0,
              partner_votes: 0,
              total_points: 0,
            }
          }
          pointsMap[ballot.third_place_name].third_place_votes++
          pointsMap[ballot.third_place_name].total_points += 1
        }

        // Honorable mention: 0.5 points
        if (ballot.honorable_mention_name) {
          if (!pointsMap[ballot.honorable_mention_name]) {
            pointsMap[ballot.honorable_mention_name] = {
              name: ballot.honorable_mention_name,
              first_place_votes: 0,
              second_place_votes: 0,
              third_place_votes: 0,
              honorable_mention_votes: 0,
              partner_votes: 0,
              total_points: 0,
            }
          }
          pointsMap[ballot.honorable_mention_name].honorable_mention_votes++
          pointsMap[ballot.honorable_mention_name].total_points += 0.5
        }

        // Partner vote: 5 points
        if (ballot.partner_vote_name) {
          if (!pointsMap[ballot.partner_vote_name]) {
            pointsMap[ballot.partner_vote_name] = {
              name: ballot.partner_vote_name,
              first_place_votes: 0,
              second_place_votes: 0,
              third_place_votes: 0,
              honorable_mention_votes: 0,
              partner_votes: 0,
              total_points: 0,
            }
          }
          pointsMap[ballot.partner_vote_name].partner_votes++
          pointsMap[ballot.partner_vote_name].total_points += 5
        }
      })

      const leaderboard = Object.values(pointsMap)
        .sort((a, b) => b.total_points - a.total_points)
        .map((entry, index) => ({ ...entry, rank: index + 1 }))

      return NextResponse.json({ leaderboard, total_ballots: ballots?.length || 0 })
    }

    // Get ballots with filters
    let query = supabase
      .from("tommy_award_ballots")
      .select(`
        *,
        week:tommy_award_weeks(id, week_date, week_name)
      `)
      .order("week_date", { ascending: false })
      .order("created_at", { ascending: false })

    if (year) {
      const startDate = `${year}-01-01`
      const endDate = `${year}-12-31`
      query = query.gte("week_date", startDate).lte("week_date", endDate)
    }

    if (weekId) {
      query = query.eq("week_id", weekId)
    }

    if (teamMemberId) {
      // Filter by team member (received votes)
      query = query.or(
        `first_place_id.eq.${teamMemberId},second_place_id.eq.${teamMemberId},third_place_id.eq.${teamMemberId},honorable_mention_id.eq.${teamMemberId},partner_vote_id.eq.${teamMemberId}`,
      )
    }

    if (voterName) {
      query = query.ilike("voter_name", `%${voterName}%`)
    }

    const { data, error } = await query

    if (error) throw error

    return NextResponse.json({ ballots: data })
  } catch (error) {
    console.error("Error fetching tommy awards:", error)
    return NextResponse.json({ error: "Failed to fetch tommy awards" }, { status: 500 })
  }
}
