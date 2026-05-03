import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

/**
 * Returns the authenticated user's Tommy Awards statistics for the
 * Trophy Case section on the profile page. Combines:
 *  - Per-week points (`tommy_award_points`) for the lifetime breakdown
 *    and the recent-weeks timeline.
 *  - Yearly rollups (`tommy_award_yearly_totals`) when available; the
 *    weekly aggregation is the source of truth and we only surface the
 *    yearly row's `current_rank` (which the rest of the system already
 *    treats as the canonical leaderboard position).
 *
 * The endpoint is auth-gated to the logged-in team member only — it
 * should not be reused for arbitrary lookups; that would be a separate
 * route under /api/team-members/[id]/trophy-case if we ever need it.
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

  // Fan-out: weekly points, yearly totals, and feedback received in parallel.
  // Sort weekly results in JS rather than the database to avoid a second
  // round-trip when computing the "best week".
  const [pointsRes, yearlyRes, feedbackRes] = await Promise.all([
    supabase
      .from("tommy_award_points")
      .select(
        "id, week_id, week_date, first_place_votes, second_place_votes, third_place_votes, honorable_mention_votes, partner_votes, total_points",
      )
      .eq("team_member_id", teamMemberId)
      .order("week_date", { ascending: false })
      .limit(200),
    supabase
      .from("tommy_award_yearly_totals")
      .select(
        "year, total_first_place_votes, total_second_place_votes, total_third_place_votes, total_honorable_mention_votes, total_partner_votes, total_points, weeks_participated, current_rank",
      )
      .eq("team_member_id", teamMemberId)
      .order("year", { ascending: false }),
    // Fetch all ballots where this team member was nominated in any position
    // to surface the feedback/notes they received from teammates
    supabase
      .from("tommy_award_ballots")
      .select(
        "id, week_date, voter_name, first_place_id, first_place_notes, second_place_id, second_place_notes, third_place_id, third_place_notes, honorable_mention_id, honorable_mention_notes, partner_vote_id, partner_vote_notes, submitted_at",
      )
      .or(
        `first_place_id.eq.${teamMemberId},second_place_id.eq.${teamMemberId},third_place_id.eq.${teamMemberId},honorable_mention_id.eq.${teamMemberId},partner_vote_id.eq.${teamMemberId}`,
      )
      .order("week_date", { ascending: false })
      .limit(100),
  ])

  if (pointsRes.error) {
    return NextResponse.json({ error: pointsRes.error.message }, { status: 500 })
  }

  const points = pointsRes.data || []
  const yearly = yearlyRes.data || []
  const feedbackBallots = feedbackRes.data || []

  // Transform ballots into feedback items — extract only the notes where this
  // team member was nominated in that specific slot
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

  // Lifetime aggregation from the weekly source-of-truth. Numeric coercion
  // matters here: total_points comes back as a Postgres `numeric` which
  // serializes to a string in JSON.
  const lifetime = points.reduce(
    (acc, p) => {
      acc.firstPlace += p.first_place_votes || 0
      acc.secondPlace += p.second_place_votes || 0
      acc.thirdPlace += p.third_place_votes || 0
      acc.honorableMention += p.honorable_mention_votes || 0
      acc.partner += p.partner_votes || 0
      acc.totalPoints += Number(p.total_points || 0)
      // A "week placed" is any week where the user received at least one vote.
      const placed =
        (p.first_place_votes || 0) +
          (p.second_place_votes || 0) +
          (p.third_place_votes || 0) +
          (p.honorable_mention_votes || 0) +
          (p.partner_votes || 0) >
        0
      if (placed) acc.weeksPlaced += 1
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

  // Best week = highest total_points in any single week. Ties broken by
  // most-recent date so the user sees their freshest peak.
  let bestWeek: (typeof points)[number] | null = null
  for (const p of points) {
    const score = Number(p.total_points || 0)
    if (!bestWeek || score > Number(bestWeek.total_points || 0)) {
      bestWeek = p
    }
  }

  // Trophy count = total number of times the user took 1st place across
  // all weeks. This is more meaningful than "first_place_votes" which
  // counts individual voters, not weeks won.
  const weeksWon = points.filter((p) => (p.first_place_votes || 0) > 0).length
  const podiumWeeks = points.filter(
    (p) =>
      (p.first_place_votes || 0) > 0 ||
      (p.second_place_votes || 0) > 0 ||
      (p.third_place_votes || 0) > 0,
  ).length

  // Best rank across all years on the yearly leaderboard. Lower is better.
  // We ignore rank=0 rows (which the materialized view emits when the year
  // has no participation yet).
  const bestRank = yearly
    .map((y) => y.current_rank)
    .filter((r) => typeof r === "number" && r > 0)
    .reduce<number | null>((acc, r) => (acc === null || r < acc ? r : acc), null)

  return NextResponse.json({
    teamMember: {
      id: teamMemberId,
      full_name: teamMember.full_name,
    },
    lifetime: {
      ...lifetime,
      // Round to 1 decimal — the points system uses 0.5-step weights but
      // displaying full floats is noisy.
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
    // Recent activity — last 12 weeks where the user got any votes. The
    // table has a row per (member, week) pair regardless of votes, so we
    // filter to non-zero rows to show meaningful history.
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
    // Drop rows where the materialized yearly view hasn't been refreshed
    // yet (`total_points = 0 AND weeks_participated = 0`). Keeping them
    // would surface contradictory data — e.g. lifetime shows 15 pts but
    // the only yearly row reads "0 pts, 0 weeks" — and would suggest the
    // user has been benched when in fact the rollup just hasn't run.
    yearly: yearly
      .filter(
        (y) =>
          Number(y.total_points || 0) > 0 ||
          (y.weeks_participated || 0) > 0 ||
          (y.current_rank || 0) > 0,
      )
      .map((y) => ({
        year: y.year,
        points: Number(y.total_points || 0),
        rank: y.current_rank,
        weeksParticipated: y.weeks_participated || 0,
        firstPlace: y.total_first_place_votes || 0,
        secondPlace: y.total_second_place_votes || 0,
        thirdPlace: y.total_third_place_votes || 0,
        honorableMention: y.total_honorable_mention_votes || 0,
        partner: y.total_partner_votes || 0,
      })),
    // Feedback received from teammates — notes written when they voted
    // for this team member. Only entries with actual notes are included.
    feedbackReceived,
  })
}
