import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"
import { assignDenseRanks, awardWeeklyPodiumCredit } from "@/lib/tommy-awards-ranking"

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const searchParams = request.nextUrl.searchParams

  const year = searchParams.get("year")
  const weekId = searchParams.get("week_id") // single week (legacy)
  const weekIds = searchParams.get("week_ids") // comma-separated week IDs (multi-select)
  const weekIdList = weekIds ? weekIds.split(",").filter(Boolean) : weekId ? [weekId] : []
  const teamMemberId = searchParams.get("team_member_id")
  const voterName = searchParams.get("voter_name")
  const type = searchParams.get("type") || "ballots" // ballots, weeks, leaderboard, team_members

  try {
    // Get the week_id of the most recently submitted ballot.
    // Used to default the filter so widgets show data even if the current
    // week has no votes yet.
    if (type === "latest_ballot_week") {
      const { data, error } = await supabase
        .from("tommy_award_ballots")
        .select("week_id, week_date")
        .order("week_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) throw error
      return NextResponse.json({ week_id: data?.week_id || null, week_date: data?.week_date || null })
    }

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
      // Hidden from Tommy Awards: Grace Cha, Beth Nietupski
      // Ganesh Vasan and Thameem JA are combined as "P24" (formerly "G&T")
      const HIDDEN_MEMBERS = ["Grace Cha", "Beth Nietupski"]
      const COMBINED_VOTERS = ["Ganesh Vasan", "Thameem JA"]
      
      const { data, error } = await supabase
        .from("team_members")
        .select("id, full_name, first_name, last_name, is_active")
        .order("full_name")

      if (error) throw error
      
      // Filter out hidden members and combined voters
      const filteredMembers = (data || []).filter(
        (m) => !HIDDEN_MEMBERS.includes(m.full_name) && !COMBINED_VOTERS.includes(m.full_name)
      )
      
      // Add the combined "P24" entry
      const gtEntry = {
        id: "P24",
        full_name: "P24",
        first_name: "P24",
        last_name: "",
        is_active: true,
      }
      
      // Insert P24 in alphabetical order
      const allMembers = [...filteredMembers, gtEntry].sort((a, b) =>
        a.full_name.localeCompare(b.full_name)
      )
      
      return NextResponse.json({ team_members: allMembers })
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

      if (weekIdList.length > 0) {
        ballotsQuery = ballotsQuery.in("week_id", weekIdList)
      }

      const { data: ballots, error } = await ballotsQuery

      if (error) throw error

      // Ganesh Vasan and Thameem JA are combined as "P24" (legacy "G&T" rolls up too)
      const COMBINED_VOTERS = ["Ganesh Vasan", "Thameem JA", "G&T"]
      const normalizeName = (name: string) => COMBINED_VOTERS.includes(name) ? "P24" : name

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

      const ensureEntry = (name: string) => {
        const normalized = normalizeName(name)
        if (!pointsMap[normalized]) {
          pointsMap[normalized] = {
            name: normalized,
            first_place_votes: 0,
            second_place_votes: 0,
            third_place_votes: 0,
            honorable_mention_votes: 0,
            partner_votes: 0,
            total_points: 0,
          }
        }
        return pointsMap[normalized]
      }

      ballots?.forEach((ballot) => {
        // First place: 3 points
        if (ballot.first_place_name) {
          const entry = ensureEntry(ballot.first_place_name)
          entry.first_place_votes++
          entry.total_points += 3
        }

        // Second place: 2 points
        if (ballot.second_place_name) {
          const entry = ensureEntry(ballot.second_place_name)
          entry.second_place_votes++
          entry.total_points += 2
        }

        // Third place: 1 point
        if (ballot.third_place_name) {
          const entry = ensureEntry(ballot.third_place_name)
          entry.third_place_votes++
          entry.total_points += 1
        }

        // Honorable mention: 0.5 points
        if (ballot.honorable_mention_name) {
          const entry = ensureEntry(ballot.honorable_mention_name)
          entry.honorable_mention_votes++
          entry.total_points += 0.5
        }

        // Partner vote: 5 points
        if (ballot.partner_vote_name) {
          const entry = ensureEntry(ballot.partner_vote_name)
          entry.partner_votes++
          entry.total_points += 5
        }
      })

      // Hidden from Tommy Awards: Grace Cha, Beth Nietupski
      const HIDDEN_MEMBERS = ["Grace Cha", "Beth Nietupski"]

      // Dense rank so genuinely-tied entries share the same `rank`. The
      // tie predicate matches the sort: two entries share rank only when
      // their total_points are identical.
      const sortedEntries = Object.values(pointsMap)
        .filter((entry) => !HIDDEN_MEMBERS.includes(entry.name))
        .sort((a, b) => b.total_points - a.total_points)
      const leaderboard = assignDenseRanks(
        sortedEntries,
        (a, b) => a.total_points === b.total_points,
      )

      return NextResponse.json({ leaderboard, total_ballots: ballots?.length || 0 })
    }

    // Year-to-date stats: tracks weeks finished 1st/2nd/3rd based on weekly point totals
    if (type === "ytd_stats") {
      const HIDDEN_MEMBERS = ["Grace Cha", "Beth Nietupski"]
      // Ganesh Vasan and Thameem JA are combined as "P24" (legacy "G&T" rolls up too)
      const COMBINED_VOTERS = ["Ganesh Vasan", "Thameem JA", "G&T"]
      const normalizeName = (name: string) => COMBINED_VOTERS.includes(name) ? "P24" : name
      
      const targetYear = year || new Date().getFullYear().toString()
      const isYear2026OrLater = Number.parseInt(targetYear) >= 2026

      // Fetch all ballots for the year
      const startDate = `${targetYear}-01-01`
      const endDate = `${targetYear}-12-31`
      const { data: ballots, error: ballotsError } = await supabase
        .from("tommy_award_ballots")
        .select("*")
        .gte("week_date", startDate)
        .lte("week_date", endDate)

      if (ballotsError) throw ballotsError

      // Group ballots by week
      const weekBuckets: Record<string, typeof ballots> = {}
      ballots?.forEach((ballot) => {
        if (!weekBuckets[ballot.week_date]) {
          weekBuckets[ballot.week_date] = []
        }
        weekBuckets[ballot.week_date]!.push(ballot)
      })

      // Calculate per-member stats across the year
      const memberStats: Record<
        string,
        {
          name: string
          total_points: number
          first_place_votes: number
          second_place_votes: number
          third_place_votes: number
          honorable_mention_votes: number
          partner_votes: number
          weeks_in_first: number
          weeks_in_second: number
          weeks_in_third: number
          weeks_participated: number
        }
      > = {}

      const ensureMember = (rawName: string) => {
        const name = normalizeName(rawName)
        if (!memberStats[name]) {
          memberStats[name] = {
            name,
            total_points: 0,
            first_place_votes: 0,
            second_place_votes: 0,
            third_place_votes: 0,
            honorable_mention_votes: 0,
            partner_votes: 0,
            weeks_in_first: 0,
            weeks_in_second: 0,
            weeks_in_third: 0,
            weeks_participated: 0,
          }
        }
        return memberStats[name]!
      }

      // Process each week to determine podium finishers and aggregate vote counts
      Object.entries(weekBuckets).forEach(([weekDate, weekBallots]) => {
        const weeklyPoints: Record<string, number> = {}
        const weeklyParticipants = new Set<string>()

        weekBallots.forEach((ballot) => {
          // 1st place: 3 points
          if (ballot.first_place_name) {
            const normalized = normalizeName(ballot.first_place_name)
            const m = ensureMember(ballot.first_place_name)
            m.first_place_votes++
            m.total_points += 3
            weeklyPoints[normalized] = (weeklyPoints[normalized] || 0) + 3
            weeklyParticipants.add(normalized)
          }
          // 2nd place: 2 points
          if (ballot.second_place_name) {
            const normalized = normalizeName(ballot.second_place_name)
            const m = ensureMember(ballot.second_place_name)
            m.second_place_votes++
            m.total_points += 2
            weeklyPoints[normalized] = (weeklyPoints[normalized] || 0) + 2
            weeklyParticipants.add(normalized)
          }
          // 3rd place: 1 point
          if (ballot.third_place_name) {
            const normalized = normalizeName(ballot.third_place_name)
            const m = ensureMember(ballot.third_place_name)
            m.third_place_votes++
            m.total_points += 1
            weeklyPoints[normalized] = (weeklyPoints[normalized] || 0) + 1
            weeklyParticipants.add(normalized)
          }
          // Honorable mention: 0.5 points (pre-2026 only)
          if (!isYear2026OrLater && ballot.honorable_mention_name) {
            const normalized = normalizeName(ballot.honorable_mention_name)
            const m = ensureMember(ballot.honorable_mention_name)
            m.honorable_mention_votes++
            m.total_points += 0.5
            weeklyPoints[normalized] = (weeklyPoints[normalized] || 0) + 0.5
            weeklyParticipants.add(normalized)
          }
          // Partner vote: 5 points (pre-2026 only)
          if (!isYear2026OrLater && ballot.partner_vote_name) {
            const normalized = normalizeName(ballot.partner_vote_name)
            const m = ensureMember(ballot.partner_vote_name)
            m.partner_votes++
            m.total_points += 5
            weeklyPoints[normalized] = (weeklyPoints[normalized] || 0) + 5
            weeklyParticipants.add(normalized)
          }
        })

        // Mark weeks participated (already normalized in weeklyParticipants)
        weeklyParticipants.forEach((normalizedName) => {
          memberStats[normalizedName]!.weeks_participated++
        })

        // Determine podium finishers for this week using **dense ranking**
        // (1, 1, 2, 3): tied members share a rank, but a tie at the top
        // does NOT consume later podium spots. Two people tied for 1st
        // both earn `weeks_in_first`, the next-best person earns
        // `weeks_in_second`, and the one after them earns
        // `weeks_in_third`. See lib/tommy-awards-ranking.ts for the
        // shared rank logic.
        const sorted = Object.entries(weeklyPoints)
          .map(([name, points]) => ({ name, points }))
          .sort((a, b) => b.points - a.points)

        if (sorted.length === 0) return

        awardWeeklyPodiumCredit(sorted, (name, place) => {
          const member = ensureMember(name)
          if (place === 1) member.weeks_in_first++
          else if (place === 2) member.weeks_in_second++
          else if (place === 3) member.weeks_in_third++
        })
      })

      const totalWeeks = Object.keys(weekBuckets).length

      // Sort with the cascading tiebreakers we've been using all season:
      // total_points → weeks_in_first → weeks_in_second → weeks_in_third.
      // Two members are only ranked equal if they match on ALL of those
      // — that's almost always rare enough that ties surface naturally,
      // but when they do happen the shared `rank` correctly signals it.
      const sortedYtd = Object.values(memberStats)
        .filter((entry) => !HIDDEN_MEMBERS.includes(entry.name))
        .sort((a, b) => {
          if (b.total_points !== a.total_points) return b.total_points - a.total_points
          if (b.weeks_in_first !== a.weeks_in_first) return b.weeks_in_first - a.weeks_in_first
          if (b.weeks_in_second !== a.weeks_in_second) return b.weeks_in_second - a.weeks_in_second
          return b.weeks_in_third - a.weeks_in_third
        })
      const ytdLeaderboard = assignDenseRanks(
        sortedYtd,
        (a, b) =>
          a.total_points === b.total_points &&
          a.weeks_in_first === b.weeks_in_first &&
          a.weeks_in_second === b.weeks_in_second &&
          a.weeks_in_third === b.weeks_in_third,
      )

      return NextResponse.json({
        ytd_leaderboard: ytdLeaderboard,
        total_weeks: totalWeeks,
        total_ballots: ballots?.length || 0,
        year: targetYear,
      })
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

    if (weekIdList.length > 0) {
      query = query.in("week_id", weekIdList)
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
