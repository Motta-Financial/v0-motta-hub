/**
 * Deal stage advancement.
 *
 * `scripts/337_deals_model.sql` defined the right state machine in its own
 * comments — `new → meeting_scheduled → met → debriefed → won/lost` — and
 * then nothing ever drove it. `findOrCreateDeal` only ever writes `new`;
 * the 129 deals sitting at `debriefed` were set by that migration's
 * one-time backfill and haven't moved since. No deal has ever reached
 * `won` or `lost`, so the pipeline cannot report conversion at all.
 *
 * This module is the missing driver. The events that should advance a
 * deal already fire — a Calendly booking, a meeting ending, a debrief
 * submission — they just weren't wired to anything.
 *
 * ── Monotonic by design ─────────────────────────────────────────────
 * Advancement only ever moves FORWARD along the ladder. That matters
 * because these events arrive out of order in practice: the hourly
 * hub-meetings sync can process a past meeting after a debrief was
 * already filed, and a client who books a second call must not drag a
 * debriefed deal back to `meeting_scheduled`.
 *
 * `won` and `lost` are terminal and deliberately NOT automated — closing
 * an opportunity is a human judgment, and inferring it from activity
 * would be worse than leaving the field honest. Nothing here will move a
 * deal out of them either.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

export type DealStage =
  | "new"
  | "meeting_scheduled"
  | "met"
  | "debriefed"
  | "won"
  | "lost"

/** Position on the ladder. Higher wins; terminal stages sit above all. */
const ORDER: Record<DealStage, number> = {
  new: 0,
  meeting_scheduled: 1,
  met: 2,
  debriefed: 3,
  won: 4,
  lost: 4,
}

export interface AdvanceResult {
  advanced: boolean
  from: DealStage | null
  to: DealStage | null
  reason: string
}

/**
 * Move a deal forward to `target` if — and only if — that's forward.
 *
 * Never throws: stage advancement is a side effect of webhooks and cron
 * sweeps, none of which should fail because the pipeline column didn't
 * update. Callers log and carry on.
 */
export async function advanceDealStage(
  supabase: SupabaseClient,
  dealId: string | null | undefined,
  target: DealStage,
): Promise<AdvanceResult> {
  if (!dealId) {
    return { advanced: false, from: null, to: null, reason: "no deal id" }
  }

  try {
    const { data: deal, error } = await supabase
      .from("deals")
      .select("id, stage, status")
      .eq("id", dealId)
      .maybeSingle()

    if (error) {
      return { advanced: false, from: null, to: null, reason: error.message }
    }
    if (!deal) {
      return { advanced: false, from: null, to: null, reason: "deal not found" }
    }

    const current = (deal.stage as DealStage) ?? "new"

    // A closed deal is finished. Re-opening it is a human decision.
    if (deal.status === "closed" || current === "won" || current === "lost") {
      return {
        advanced: false,
        from: current,
        to: null,
        reason: `deal is ${current} — terminal, left alone`,
      }
    }

    if (ORDER[target] <= ORDER[current]) {
      return {
        advanced: false,
        from: current,
        to: null,
        reason: `${target} is not ahead of ${current}`,
      }
    }

    // Guard the write with the stage we read, so two concurrent events
    // (webhook + cron on the same meeting) can't leapfrog each other.
    const { error: updErr } = await supabase
      .from("deals")
      .update({ stage: target })
      .eq("id", dealId)
      .eq("stage", current)

    if (updErr) {
      return { advanced: false, from: current, to: null, reason: updErr.message }
    }

    return { advanced: true, from: current, to: target, reason: `${current} → ${target}` }
  } catch (err) {
    return {
      advanced: false,
      from: null,
      to: null,
      reason: (err as Error).message,
    }
  }
}
