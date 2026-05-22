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

    // Get weeks for filter dropdown.
    //
    // Weeks are pre-seeded years in advance (one row per Friday through
    // 2026 etc.) so voting forms have a stable target — but we don't
    // want those future placeholders cluttering the Weekly Leaderboard
    // picker. Cap the result at today: any week dated after today is
    // hidden from the dropdown until that Friday actually arrives.
    if (type === "weeks") {
      const todayIso = new Date().toISOString().slice(0, 10)
      let query = supabase
        .from("tommy_award_weeks")
        .select("*")
        .lte("week_date", todayIso)
        .order("week_date", { ascending: false })

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

    // Weekly recap (AI summary + generated F1-podium image) for the
    // currently-filtered week. Surfaces the same artifact that ALFRED
    // emails out on Fridays inside the Tommy Awards dashboard so the
    // Weekly Leaderboard can render it alongside the standings.
    //
    // Resolution rules (intentionally narrow — a recap is per-week):
    //   - exactly one week_id selected → return that week's recap row
    //   - otherwise → return null so the UI hides the recap panel
    // We never collapse multi-week filters down to "the latest one"
    // because the resulting summary would describe a different week
    // than the leaderboard above it.
    //
    // We also return the selected week's `week_date` independently of
    // whether a recap row exists. The leaderboard uses that date to
    // decide whether to show the "Results Sealed" waiting screen — we
    // ONLY seal the in-flight current week (Friday hasn't shipped its
    // recap yet). Pre-recap-system weeks have no row but should still
    // reveal their standings normally; without a date the component
    // would over-eagerly seal those too.
    if (type === "weekly_recap") {
      if (weekIdList.length !== 1) {
        return NextResponse.json({ recap: null, week_date: null })
      }
      const [{ data: recapRow, error: recapErr }, { data: weekRow }] =
        await Promise.all([
          supabase
            .from("tommy_weekly_recaps")
            .select(
              "week_id, week_date, week_label, total_ballots, ai_summary, podium_image_url, podium_pdf_url, top_three, email_sent_at, created_at",
            )
            .eq("week_id", weekIdList[0])
            .maybeSingle(),
          supabase
            .from("tommy_award_weeks")
            .select("week_date")
            .eq("id", weekIdList[0])
            .maybeSingle(),
        ])

      if (recapErr) throw recapErr
      return NextResponse.json({
        recap: recapRow || null,
        week_date: recapRow?.week_date ?? weekRow?.week_date ?? null,
      })
    }

    // "all_recaps" — full archive of persisted Friday recaps, newest
    // first. Powers the new "Weekly Tommy's" tab on the Motta Alliance
    // gallery so every issued recap (image + PDF + summary) is browsable
    // alongside the comic editions.
    if (type === "all_recaps") {
      const { data, error } = await supabase
        .from("tommy_weekly_recaps")
        .select(
          "week_id, week_date, week_label, total_ballots, ai_summary, podium_image_url, podium_pdf_url, top_three, email_sent_at, created_at",
        )
        .order("week_date", { ascending: false })

      if (error) throw error
      return NextResponse.json({ recaps: data || [] })
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

    // Per-member breakdown:
    //   mode=weekly → list of votes received in the filtered week(s),
    //     grouped by category (1st/2nd/3rd/HM/Partner) with voter names.
    //   mode=ytd    → one row per week in the year showing position,
    //     points, and how the points were earned.
    // Used by the click-through dialog from the Weekly Leaderboard
    // and the YTD Standings.
    if (type === "member_breakdown") {
      const memberName = searchParams.get("name")
      const mode = searchParams.get("mode") || "weekly" // weekly | ytd
      if (!memberName) {
        return NextResponse.json({ error: "name is required" }, { status: 400 })
      }

      // "P24" rolls up Ganesh & Thameem's individual votes plus any
      // legacy "G&T" ballots — match all three names server-side so the
      // dialog includes every contributing ballot row.
      const COMBINED_VOTERS = ["Ganesh Vasan", "Thameem JA", "G&T"]
      const isP24 = memberName === "P24"
      const matchedNames = isP24 ? ["P24", ...COMBINED_VOTERS] : [memberName]

      let ballotsQuery = supabase.from("tommy_award_ballots").select("*")

      const targetYear = year || new Date().getFullYear().toString()

      if (mode === "ytd" || year) {
        const startDate = `${targetYear}-01-01`
        const endDate = `${targetYear}-12-31`
        ballotsQuery = ballotsQuery.gte("week_date", startDate).lte("week_date", endDate)
      }

      if (mode === "weekly" && weekIdList.length > 0) {
        ballotsQuery = ballotsQuery.in("week_id", weekIdList)
      }

      const { data: ballots, error: bErr } = await ballotsQuery
      if (bErr) throw bErr

      const isYear2026OrLater = Number.parseInt(targetYear) >= 2026
      const matches = (n: string | null | undefined) => !!n && matchedNames.includes(n)

      if (mode === "weekly") {
        const first: Array<{ voter: string; week_date: string }> = []
        const second: Array<{ voter: string; week_date: string }> = []
        const third: Array<{ voter: string; week_date: string }> = []
        const hm: Array<{ voter: string; week_date: string }> = []
        const partner: Array<{ voter: string; week_date: string }> = []
        let totalPoints = 0
        ballots?.forEach((b) => {
          if (matches(b.first_place_name)) {
            first.push({ voter: b.voter_name, week_date: b.week_date })
            totalPoints += 3
          }
          if (matches(b.second_place_name)) {
            second.push({ voter: b.voter_name, week_date: b.week_date })
            totalPoints += 2
          }
          if (matches(b.third_place_name)) {
            third.push({ voter: b.voter_name, week_date: b.week_date })
            totalPoints += 1
          }
          if (!isYear2026OrLater && matches(b.honorable_mention_name)) {
            hm.push({ voter: b.voter_name, week_date: b.week_date })
            totalPoints += 0.5
          }
          if (!isYear2026OrLater && matches(b.partner_vote_name)) {
            partner.push({ voter: b.voter_name, week_date: b.week_date })
            totalPoints += 5
          }
        })
        return NextResponse.json({
          mode: "weekly",
          name: memberName,
          total_points: totalPoints,
          total_ballots: ballots?.length || 0,
          votes: { first, second, third, hm, partner },
          is_2026_or_later: isYear2026OrLater,
        })
      }

      // YTD mode: bucket by week, compute position from weekly point
      // totals across ALL members, and return one row per week the
      // member appeared on.
      const weekBuckets: Record<string, typeof ballots> = {}
      ballots?.forEach((b) => {
        if (!weekBuckets[b.week_date]) weekBuckets[b.week_date] = []
        weekBuckets[b.week_date]!.push(b)
      })

      const normalizeName = (n: string) => (COMBINED_VOTERS.includes(n) ? "P24" : n)
      const memberKey = normalizeName(memberName)

      const weekRows: Array<{
        week_date: string
        points: number
        finish: number | null // 1, 2, 3, or null (off podium)
        first_place_votes: number
        second_place_votes: number
        third_place_votes: number
        hm_votes: number
        partner_votes: number
      }> = []

      let ytdTotalPoints = 0
      let firstVotes = 0
      let secondVotes = 0
      let thirdVotes = 0
      let hmVotes = 0
      let partnerVotes = 0
      let weeksFirst = 0
      let weeksSecond = 0
      let weeksThird = 0
      let weeksParticipated = 0

      Object.entries(weekBuckets).forEach(([weekDate, weekBallots]) => {
        // Compute all-member weekly totals to determine finish.
        const weeklyPoints: Record<string, number> = {}
        let memberPoints = 0
        let mFirst = 0, mSecond = 0, mThird = 0, mHm = 0, mPartner = 0

        weekBallots.forEach((ballot) => {
          if (ballot.first_place_name) {
            const k = normalizeName(ballot.first_place_name)
            weeklyPoints[k] = (weeklyPoints[k] || 0) + 3
            if (k === memberKey) {
              memberPoints += 3
              mFirst++
            }
          }
          if (ballot.second_place_name) {
            const k = normalizeName(ballot.second_place_name)
            weeklyPoints[k] = (weeklyPoints[k] || 0) + 2
            if (k === memberKey) {
              memberPoints += 2
              mSecond++
            }
          }
          if (ballot.third_place_name) {
            const k = normalizeName(ballot.third_place_name)
            weeklyPoints[k] = (weeklyPoints[k] || 0) + 1
            if (k === memberKey) {
              memberPoints += 1
              mThird++
            }
          }
          if (!isYear2026OrLater && ballot.honorable_mention_name) {
            const k = normalizeName(ballot.honorable_mention_name)
            weeklyPoints[k] = (weeklyPoints[k] || 0) + 0.5
            if (k === memberKey) {
              memberPoints += 0.5
              mHm++
            }
          }
          if (!isYear2026OrLater && ballot.partner_vote_name) {
            const k = normalizeName(ballot.partner_vote_name)
            weeklyPoints[k] = (weeklyPoints[k] || 0) + 5
            if (k === memberKey) {
              memberPoints += 5
              mPartner++
            }
          }
        })

        if (memberPoints === 0) return // member wasn't voted on this week

        // Dense rank to derive finish: same logic as the YTD aggregator
        const sorted = Object.entries(weeklyPoints)
          .map(([name, points]) => ({ name, points }))
          .sort((a, b) => b.points - a.points)
        let rank = 1
        let finish: number | null = null
        for (let i = 0; i < sorted.length; i++) {
          if (i > 0 && sorted[i]!.points < sorted[i - 1]!.points) rank++
          if (sorted[i]!.name === memberKey) {
            finish = rank <= 3 ? rank : null
            break
          }
        }

        weekRows.push({
          week_date: weekDate,
          points: memberPoints,
          finish,
          first_place_votes: mFirst,
          second_place_votes: mSecond,
          third_place_votes: mThird,
          hm_votes: mHm,
          partner_votes: mPartner,
        })

        ytdTotalPoints += memberPoints
        firstVotes += mFirst
        secondVotes += mSecond
        thirdVotes += mThird
        hmVotes += mHm
        partnerVotes += mPartner
        weeksParticipated++
        if (finish === 1) weeksFirst++
        else if (finish === 2) weeksSecond++
        else if (finish === 3) weeksThird++
      })

      // Newest week first
      weekRows.sort((a, b) => (a.week_date < b.week_date ? 1 : -1))

      return NextResponse.json({
        mode: "ytd",
        name: memberName,
        year: targetYear,
        total_points: ytdTotalPoints,
        first_place_votes: firstVotes,
        second_place_votes: secondVotes,
        third_place_votes: thirdVotes,
        hm_votes: hmVotes,
        partner_votes: partnerVotes,
        weeks_in_first: weeksFirst,
        weeks_in_second: weeksSecond,
        weeks_in_third: weeksThird,
        weeks_participated: weeksParticipated,
        week_rows: weekRows,
        is_2026_or_later: isYear2026OrLater,
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
