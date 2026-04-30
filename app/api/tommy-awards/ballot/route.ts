import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"

/**
 * Server-side Tommy Award ballot submission/amendment.
 *
 * The browser POSTs here (same-origin, motta.cpa) instead of writing to Supabase
 * directly. This avoids corporate web filters (e.g. Zscaler) that intercept
 * direct browser → Supabase POST traffic and return HTML block pages.
 *
 * Same insert + history audit semantics as the previous client-side flow.
 */

type Placement = {
  memberId: string | null
  memberName: string | null
  notes: string | null
}

type BallotSnapshot = {
  first_place_id: string | null
  first_place_name: string | null
  first_place_notes: string | null
  second_place_id: string | null
  second_place_name: string | null
  second_place_notes: string | null
  third_place_id: string | null
  third_place_name: string | null
  third_place_notes: string | null
  honorable_mention_id: string | null
  honorable_mention_name: string | null
  honorable_mention_notes: string | null
  partner_vote_id: string | null
  partner_vote_name: string | null
  partner_vote_notes: string | null
}

type SubmitBody = {
  weekId: string
  weekDate: string
  voterId: string // "G&T" or a real team_members uuid
  voterName: string
  firstPlace: Placement
  secondPlace: Placement
  thirdPlace: Placement
  honorableMention?: Placement
  partnerVote?: Placement | null
  isPartner: boolean
  is2026OrLater: boolean
  amendment?: {
    existingBallotId: string
    originalBallot: BallotSnapshot
    changes: Array<{ field: string; before: string; after: string }>
  } | null
}

// Helper: when "G&T" appears in any uuid column it must become NULL.
// Real uuids must match this pattern; everything else (including "G&T") -> null.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const toUuidOrNull = (id: string | null | undefined): string | null => {
  if (!id) return null
  return UUID_RE.test(id) ? id : null
}

export async function POST(request: NextRequest) {
  let body: SubmitBody
  try {
    body = (await request.json()) as SubmitBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  // Basic validation
  if (!body.weekId || !body.weekDate || !body.voterId || !body.voterName) {
    return NextResponse.json({ error: "Missing required fields (week, voter)" }, { status: 400 })
  }
  if (!body.firstPlace?.memberId || !body.secondPlace?.memberId || !body.thirdPlace?.memberId) {
    return NextResponse.json(
      { error: "Please select 1st, 2nd, and 3rd place." },
      { status: 400 },
    )
  }

  const supabase = await createClient()
  const isGT = body.voterId === "G&T"

  // Build the ballot row using uuid-safe coercion for every *_id column.
  const ballotData: Record<string, unknown> = {
    week_id: body.weekId,
    week_date: body.weekDate,
    voter_id: isGT ? null : toUuidOrNull(body.voterId),
    voter_name: body.voterName,
    first_place_id: toUuidOrNull(body.firstPlace.memberId),
    first_place_name: body.firstPlace.memberName,
    first_place_notes: body.firstPlace.notes,
    second_place_id: toUuidOrNull(body.secondPlace.memberId),
    second_place_name: body.secondPlace.memberName,
    second_place_notes: body.secondPlace.notes,
    third_place_id: toUuidOrNull(body.thirdPlace.memberId),
    third_place_name: body.thirdPlace.memberName,
    third_place_notes: body.thirdPlace.notes,
  }

  if (!body.is2026OrLater) {
    ballotData.honorable_mention_id = toUuidOrNull(body.honorableMention?.memberId ?? null)
    ballotData.honorable_mention_name = body.honorableMention?.memberName ?? null
    ballotData.honorable_mention_notes = body.honorableMention?.notes ?? null
    ballotData.partner_vote_id = body.isPartner ? toUuidOrNull(body.partnerVote?.memberId ?? null) : null
    ballotData.partner_vote_name = body.isPartner ? body.partnerVote?.memberName ?? null : null
    ballotData.partner_vote_notes = body.isPartner ? body.partnerVote?.notes ?? null : null
  } else {
    ballotData.honorable_mention_id = null
    ballotData.honorable_mention_name = null
    ballotData.honorable_mention_notes = null
    ballotData.partner_vote_id = null
    ballotData.partner_vote_name = null
    ballotData.partner_vote_notes = null
  }

  try {
    let ballotId: string | null = null

    if (body.amendment?.existingBallotId) {
      const { existingBallotId, originalBallot, changes } = body.amendment

      // Snapshot the previous state into history before mutating.
      if (originalBallot && changes && changes.length > 0) {
        try {
          await supabase.from("tommy_award_ballot_history").insert({
            ballot_id: existingBallotId,
            changed_by_id: isGT ? null : toUuidOrNull(body.voterId),
            changed_by_name: body.voterName,
            change_type: "amended",
            first_place_id: toUuidOrNull(originalBallot.first_place_id),
            first_place_name: originalBallot.first_place_name,
            first_place_notes: originalBallot.first_place_notes,
            second_place_id: toUuidOrNull(originalBallot.second_place_id),
            second_place_name: originalBallot.second_place_name,
            second_place_notes: originalBallot.second_place_notes,
            third_place_id: toUuidOrNull(originalBallot.third_place_id),
            third_place_name: originalBallot.third_place_name,
            third_place_notes: originalBallot.third_place_notes,
            honorable_mention_id: toUuidOrNull(originalBallot.honorable_mention_id),
            honorable_mention_name: originalBallot.honorable_mention_name,
            honorable_mention_notes: originalBallot.honorable_mention_notes,
            partner_vote_id: toUuidOrNull(originalBallot.partner_vote_id),
            partner_vote_name: originalBallot.partner_vote_name,
            partner_vote_notes: originalBallot.partner_vote_notes,
            change_summary: { changes },
          })
        } catch (historyErr) {
          console.log("[v0] history table insert failed (non-fatal):", historyErr)
        }
      }

      const { error: updateError } = await supabase
        .from("tommy_award_ballots")
        .update(ballotData)
        .eq("id", existingBallotId)

      if (updateError) {
        return NextResponse.json(
          {
            error: updateError.message,
            code: updateError.code,
            details: updateError.details,
            hint: updateError.hint,
          },
          { status: 400 },
        )
      }
      ballotId = existingBallotId
    } else {
      const { data: newBallot, error: insertError } = await supabase
        .from("tommy_award_ballots")
        .insert(ballotData)
        .select("id")
        .single()

      if (insertError) {
        // Surface duplicate cleanly (the only "expected" error).
        const status = insertError.code === "23505" ? 409 : 400
        return NextResponse.json(
          {
            error: insertError.message,
            code: insertError.code,
            details: insertError.details,
            hint: insertError.hint,
          },
          { status },
        )
      }
      ballotId = newBallot?.id ?? null

      // Initial creation snapshot.
      if (ballotId) {
        try {
          await supabase.from("tommy_award_ballot_history").insert({
            ballot_id: ballotId,
            changed_by_id: isGT ? null : toUuidOrNull(body.voterId),
            changed_by_name: body.voterName,
            change_type: "created",
            first_place_id: ballotData.first_place_id,
            first_place_name: ballotData.first_place_name,
            first_place_notes: ballotData.first_place_notes,
            second_place_id: ballotData.second_place_id,
            second_place_name: ballotData.second_place_name,
            second_place_notes: ballotData.second_place_notes,
            third_place_id: ballotData.third_place_id,
            third_place_name: ballotData.third_place_name,
            third_place_notes: ballotData.third_place_notes,
            honorable_mention_id: ballotData.honorable_mention_id,
            honorable_mention_name: ballotData.honorable_mention_name,
            honorable_mention_notes: ballotData.honorable_mention_notes,
            partner_vote_id: ballotData.partner_vote_id,
            partner_vote_name: ballotData.partner_vote_name,
            partner_vote_notes: ballotData.partner_vote_notes,
            change_summary: null,
          })
        } catch (historyErr) {
          console.log("[v0] history table insert failed (non-fatal):", historyErr)
        }
      }
    }

    return NextResponse.json({ success: true, ballotId })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    console.error("[v0] /api/tommy-awards/ballot POST failed:", err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
