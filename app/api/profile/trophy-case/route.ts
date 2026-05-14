import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

/**
 * Returns the authenticated user's Tommy Awards statistics for the
 * Trophy Case section on the profile page.
 *
 * Data model
 * ─────────
 * Three tables back this endpoint:
 *
 *   1. `tommy_award_ballots`        — raw votes submitted by teammates.
 *                                     ONE BALLOT = one voter's picks for
 *                                     one week. This is the source of
 *                                     truth.
 *
 *   2. `tommy_award_points`         — aggregated per (member, week). Now
 *                                     kept in sync by a trigger; we treat
 *                                     it as the canonical input for both
 *                                     the lifetime and yearly views.
 *
 *   3. `tommy_award_yearly_totals`  — pre-rolled yearly rank/totals. Used
 *                                     ONLY to surface `current_rank` (the
 *                                     leaderboard position the rest of the
 *                                     system already displays). The yearly
 *                                     point totals shown on this page are
 *                                     recomputed from `tommy_award_points`
 *                                     on every request so prior-year data
 *                                     can never be missing again, even if
 *                                     the yearly rollup drifts.
 *
 * Auth
 * ────
 * Auth-gated to the logged-in team member only. Don't reuse this endpoint
 * for arbitrary member lookups — that would be a separate route at
 * /api/team-members/[id]/trophy-case.
 */
export async function GET() {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { data: teamMember, error: tmError } = await supabase
    .from("team_members")
    .select("id, full_name")
    .eq("auth_user_id", user.id)
    .single()
  if (tmError || !teamMember) {
    return NextResponse.json({ error: "Team member not found" }, { status: 404 })
  }

  const teamMemberId = teamMember.id

  // Fan-out: weekly points, yearly rank rollup, and feedback received.
  // We deliberately pull ALL of the member's weekly points rows (no
  // `.limit`) because:
  //   • There's exactly one row per (member, week); for a long-tenured
  //     employee with ~50 weeks/yr × 5 yrs of history that's still only
  //     ~250 rows. The previous 200-row cap was silently truncating
  //     prior-year data for the most active people.
  //   • The lifetime totals AND the yearly trend are both derived from
  //     this list, so any cap creates inconsistencies between sections.
  const [pointsRes, rankRes, feedbackRes] = await Promise.all([
    supabase
      .from("tommy_award_points")
      .select(
        "id, week_id, week_date, first_place_votes, second_place_votes, third_place_votes, honorable_mention_votes, partner_votes, total_points",
      )
      .eq("team_member_id", teamMemberId)
      .order("week_date", { ascending: false }),
    supabase
      .from("tommy_award_yearly_totals")
      .select("year, current_rank")
      .eq("team_member_id", teamMemberId),
    // All ballots where this team member was nominated in any position —
    // used to surface the feedback notes voters wrote.
    supabase
      .from("tommy_award_ballots")
      .select(
        "id, week_date, voter_name, first_place_id, first_place_notes, second_place_id, second_place_notes, third_place_id, third_place_notes, honorable_mention_id, honorable_mention_notes, partner_vote_id, partner_vote_notes, submitted_at",
      )
      .or(
        `first_place_id.eq.${teamMemberId},second_place_id.eq.${teamMemberId},third_place_id.eq.${teamMemberId},honorable_mention_id.eq.${teamMemberId},partner_vote_id.eq.${teamMemberId}`,
      )
      .order("week_date", { ascending: false })
      .limit(200),
  ])

  if (pointsRes.error) {
    return NextResponse.json({ error: pointsRes.error.message }, { status: 500 })
  }

  const points = pointsRes.data || []
  const rankRows = rankRes.data || []
  const feedbackBallots = feedbackRes.data || []

  // ── Feedback Received ────────────────────────────────────────────────
  // Pull only the notes that were written for THIS team member in their
  // specific placement slot. A single ballot can contribute multiple
  // feedback items (e.g. voter put them at 1st and partner).
  type FeedbackItem = {
    id: string
    weekDate: string
    voterName: string
    placement: "1st" | "2nd" | "3rd" | "HM" | "Partner"
    notes: string | null
    submittedAt: string | null
  }

  const feedbackReceived: FeedbackItem[] = []
  for (const ballot of feedbackBallots) {
    if (ballot.first_place_id === teamMemberId && ballot.first_place_notes) {
      feedbackReceived.push({
        id: `${ballot.id}-1st`,
        weekDate: ballot.week_date,
        voterName: ballot.voter_name || "Anonymous",
        placement: "1st",
        notes: ballot.first_place_notes,
        submittedAt: ballot.submitted_at,
      })
    }
    if (ballot.second_place_id === teamMemberId && ballot.second_place_notes) {
      feedbackReceived.push({
        id: `${ballot.id}-2nd`,
        weekDate: ballot.week_date,
        voterName: ballot.voter_name || "Anonymous",
        placement: "2nd",
        notes: ballot.second_place_notes,
        submittedAt: ballot.submitted_at,
      })
    }
    if (ballot.third_place_id === teamMemberId && ballot.third_place_notes) {
      feedbackReceived.push({
        id: `${ballot.id}-3rd`,
        weekDate: ballot.week_date,
        voterName: ballot.voter_name || "Anonymous",
        placement: "3rd",
        notes: ballot.third_place_notes,
        submittedAt: ballot.submitted_at,
      })
    }
    if (ballot.honorable_mention_id === teamMemberId && ballot.honorable_mention_notes) {
      feedbackReceived.push({
        id: `${ballot.id}-hm`,
        weekDate: ballot.week_date,
        voterName: ballot.voter_name || "Anonymous",
        placement: "HM",
        notes: ballot.honorable_mention_notes,
        submittedAt: ballot.submitted_at,
      })
    }
    if (ballot.partner_vote_id === teamMemberId && ballot.partner_vote_notes) {
      feedbackReceived.push({
        id: `${ballot.id}-partner`,
        weekDate: ballot.week_date,
        voterName: ballot.voter_name || "Anonymous",
        placement: "Partner",
        notes: ballot.partner_vote_notes,
        submittedAt: ballot.submitted_at,
      })
    }
  }

  // ── Lifetime Aggregation ────────────────────────────────────────────
  // Coerces total_points (Postgres `numeric` → string in JSON) to Number
  // before summing.
  const lifetime = points.reduce(
    (acc, p) => {
      acc.firstPlace += p.first_place_votes || 0
      acc.secondPlace += p.second_place_votes || 0
      acc.thirdPlace += p.third_place_votes || 0
      acc.honorableMention += p.honorable_mention_votes || 0
      acc.partner += p.partner_votes || 0
      acc.totalPoints += Number(p.total_points || 0)
      // A "week placed" = any week where the user got at least one vote.
      const totalVotes =
        (p.first_place_votes || 0) +
        (p.second_place_votes || 0) +
        (p.third_place_votes || 0) +
        (p.honorable_mention_votes || 0) +
        (p.partner_votes || 0)
      if (totalVotes > 0) acc.weeksPlaced += 1
      return acc
    },
    {
      firstPlace: 0,
      secondPlace: 0,
      thirdPlace: 0,
      honorableMention: 0,
      partner: 0,
      totalPoints: 0,
      weeksPlaced: 0,
    },
  )

  // Best week = highest single-week total. Ties broken by recency so the
  // user sees their freshest peak rather than an old one.
  let bestWeek: (typeof points)[number] | null = null
  for (const p of points) {
    const score = Number(p.total_points || 0)
    if (!bestWeek || score > Number(bestWeek.total_points || 0)) {
      bestWeek = p
    }
  }

  const weeksWon = points.filter((p) => (p.first_place_votes || 0) > 0).length
  const podiumWeeks = points.filter(
    (p) =>
      (p.first_place_votes || 0) > 0 ||
      (p.second_place_votes || 0) > 0 ||
      (p.third_place_votes || 0) > 0,
  ).length

  // ── Yearly Aggregation (authoritative) ──────────────────────────────
  // Compute yearly totals from the weekly source of truth instead of
  // trusting `tommy_award_yearly_totals.total_points`. The rank column
  // from the rollup table is still useful (it's relative to the rest of
  // the company), but the per-member point breakdown is now invulnerable
  // to rollup drift.
  type YearAgg = {
    year: number
    points: number
    weeksParticipated: number
    firstPlace: number
    secondPlace: number
    thirdPlace: number
    honorableMention: number
    partner: number
  }
  const yearMap = new Map<number, YearAgg>()
  for (const p of points) {
    const totalVotes =
      (p.first_place_votes || 0) +
      (p.second_place_votes || 0) +
      (p.third_place_votes || 0) +
      (p.honorable_mention_votes || 0) +
      (p.partner_votes || 0)
    if (totalVotes === 0) continue
    // week_date is a calendar date string like "2025-04-25". Parse as UTC
    // to avoid the year flipping in negative-UTC timezones around Jan 1.
    const year = new Date(`${p.week_date}T00:00:00Z`).getUTCFullYear()
    const existing = yearMap.get(year) || {
      year,
      points: 0,
      weeksParticipated: 0,
      firstPlace: 0,
      secondPlace: 0,
      thirdPlace: 0,
      honorableMention: 0,
      partner: 0,
    }
    existing.points += Number(p.total_points || 0)
    existing.weeksParticipated += 1
    existing.firstPlace += p.first_place_votes || 0
    existing.secondPlace += p.second_place_votes || 0
    existing.thirdPlace += p.third_place_votes || 0
    existing.honorableMention += p.honorable_mention_votes || 0
    existing.partner += p.partner_votes || 0
    yearMap.set(year, existing)
  }

  // Splice in the rank from the rollup table where we have one. If the
  // rollup is stale or missing, rank is null and the UI hides it.
  const rankByYear = new Map<number, number | null>()
  for (const r of rankRows) {
    if (typeof r.year === "number" && typeof r.current_rank === "number") {
      rankByYear.set(r.year, r.current_rank)
    }
  }

  const yearly = Array.from(yearMap.values())
    .map((y) => ({
      ...y,
      // Round to 1 decimal to match how points are displayed elsewhere.
      points: Math.round(y.points * 10) / 10,
      rank: rankByYear.get(y.year) ?? null,
    }))
    .sort((a, b) => b.year - a.year)

  // Best rank across all years (smaller is better). Only consider rows
  // with a positive rank; null/0 mean "not ranked".
  const bestRank = yearly
    .map((y) => y.rank)
    .filter((r): r is number => typeof r === "number" && r > 0)
    .reduce<number | null>((acc, r) => (acc === null || r < acc ? r : acc), null)

  // ── Year-Over-Year Trend ────────────────────────────────────────────
  // Compact array for the trend chart on the client. Ascending order
  // (earliest → latest) so the line reads left-to-right intuitively.
  const yearlyTrend = [...yearly]
    .sort((a, b) => a.year - b.year)
    .map((y) => ({
      year: y.year,
      points: y.points,
      weeksParticipated: y.weeksParticipated,
    }))

  return NextResponse.json({
    teamMember: {
      id: teamMemberId,
      full_name: teamMember.full_name,
    },
    lifetime: {
      ...lifetime,
      totalPoints: Math.round(lifetime.totalPoints * 10) / 10,
      weeksWon,
      podiumWeeks,
      bestRank,
    },
    bestWeek: bestWeek
      ? {
          weekDate: bestWeek.week_date,
          points: Number(bestWeek.total_points || 0),
          firstPlace: bestWeek.first_place_votes || 0,
          secondPlace: bestWeek.second_place_votes || 0,
          thirdPlace: bestWeek.third_place_votes || 0,
          honorableMention: bestWeek.honorable_mention_votes || 0,
          partner: bestWeek.partner_votes || 0,
        }
      : null,
    // Last 12 scoring weeks (across all years).
    recentWeeks: points
      .filter((p) => Number(p.total_points || 0) > 0)
      .slice(0, 12)
      .map((p) => ({
        weekDate: p.week_date,
        points: Number(p.total_points || 0),
        firstPlace: p.first_place_votes || 0,
        secondPlace: p.second_place_votes || 0,
        thirdPlace: p.third_place_votes || 0,
        honorableMention: p.honorable_mention_votes || 0,
        partner: p.partner_votes || 0,
      })),
    yearly,
    yearlyTrend,
    feedbackReceived,
  })
}
