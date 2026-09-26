import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { composeWeeklyRecap } from "@/lib/tommy-awards/weekly-recap"
import { triggerStage } from "@/lib/tommy-awards/pipeline"
import { isEasternHourAndWeekday, nowInEastern } from "@/lib/cron-eastern"

// ── STAGE 1 of 4: PREPARE ─────────────────────────────────────────────
// This route used to do EVERYTHING (tally → story → PDF → email → async
// image). That meant the image never made it into the Friday email,
// because the email was sent BEFORE the slow gpt-image-2 render finished.
//
// The pipeline is now split into four individually time-budgeted stages
// so the email always ships LAST with the image + PDF already baked in:
//
//   1. PREPARE  (this route)            — Friday 11:00 AM ET. Tally the
//      ballots + draft ALFRED's story, persist the story columns, then
//      chain to the image stage. NO email is sent here.
//   2. IMAGE    (/api/cron/tommy-podium-image) — render the podium art,
//      persist it, chain to the PDF stage.
//   3. PDF      (/api/cron/tommy-recap-pdf)     — build the PDF with the
//      image embedded, persist it. End of the prep chain.
//   4. SEND     (/api/cron/tommy-recap-send)    — Friday 12:00 PM ET.
//      Email the firm with the image embedded + PDF attached. Triggered
//      independently by its own cron (not by the chain) so the firm
//      always gets an email at noon even if a prep stage failed. SEND
//      ALSO re-tallies the ballots itself right before sending (see that
//      route), so the vote count / podium in the email is never stale
//      even if a ballot came in after this PREPARE stage ran.
//
// Why 11:00 AM and not 8:45 AM anymore: this stage's tally used to be
// baked into the email verbatim, so a ballot cast between the tally and
// the noon send was silently dropped from the recap. Moving PREPARE to
// 11:00 AM shrinks that window to ~1 hour (plenty of time for the
// image → PDF chain to finish before noon), and SEND's own re-tally
// closes the gap completely.
//
// PREPARE only does fast brain work (~10s), so we keep a tight ceiling.
export const maxDuration = 60

/**
 * Vercel Cron endpoint — Friday ~11:00 AM Eastern. Tallies the week's
 * ballots, drafts ALFRED's storyline recap, persists the story columns
 * on `tommy_weekly_recaps`, and kicks off the image → PDF prep chain so
 * everything is ready before the noon send.
 *
 * Vercel Cron is UTC-only, so this is scheduled at BOTH UTC hours that
 * map to 11:00 AM Eastern:
 *   - `0 15 * * 5` — 15:00 UTC = 11:00 AM EDT (Mar–Nov)
 *   - `0 16 * * 5` — 16:00 UTC = 11:00 AM EST (Nov–Mar)
 * The `isEasternHourAndWeekday(11, 5)` guard lets exactly one twin run.
 *
 * Query flags:
 *   - ?dryRun=true   — compose + return the data WITHOUT persisting or chaining.
 *   - ?force=true    — bypass the Eastern-time guard.
 *   - ?skipChain=true — persist but do NOT trigger the image stage.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.CRON_SECRET && process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  const url = new URL(request.url)
  const dryRun = url.searchParams.get("dryRun") === "true"
  const force = url.searchParams.get("force") === "true"
  const skipChain = url.searchParams.get("skipChain") === "true"

  // DST guard: only proceed at 11 AM ET on a Friday. The other UTC-twin
  // invocation exits cleanly here. QA flags bypass the guard.
  if (!dryRun && !force && !isEasternHourAndWeekday(11, 5)) {
    const { hour, weekday } = nowInEastern()
    return NextResponse.json({
      success: true,
      skipped: true,
      reason: "Not 11:00 AM Eastern on a Friday — skipping (DST twin invocation).",
      eastern_hour: hour,
      eastern_weekday: weekday,
    })
  }

  try {
    const supabase = createAdminClient()

    const composed = await composeWeeklyRecap(supabase)
    if (composed.status === "skipped") {
      return NextResponse.json({ success: true, skipped: true, message: composed.reason })
    }

    const recap = composed.data

    if (dryRun) {
      return NextResponse.json({
        success: true,
        dry_run: true,
        stage: "prepare",
        week: recap.weekLabel,
        total_ballots: recap.totalBallots,
        ai_model: recap.aiModel,
        top_three: recap.topThree,
        ai_summary: recap.aiSummary,
      })
    }

    // Persist ONLY the story columns. We intentionally leave
    // podium_image_url / podium_pdf_url / email_sent_* untouched so:
    //   - a fresh week starts them null (the chain fills them in), and
    //   - a manual re-run of PREPARE never clobbers an image/PDF that a
    //     later stage already produced.
    const { error: persistErr } = await supabase.from("tommy_weekly_recaps").upsert(
      {
        week_id: recap.weekId,
        week_date: recap.weekDate,
        week_label: recap.weekLabel,
        total_ballots: recap.totalBallots,
        ai_summary: recap.aiSummary,
        ai_model: recap.aiModel,
        top_three: recap.topThree,
        ytd_standings: recap.ytdStandings,
      },
      { onConflict: "week_id" },
    )

    if (persistErr) {
      console.error("[v0] tommy-weekly-recap (prepare): failed to persist recap row:", persistErr)
      throw persistErr
    }

    // Chain → image stage (which then chains → PDF). Fire-and-forget; the
    // image route owns its own 800s budget.
    if (!skipChain && recap.topThree.length > 0) {
      triggerStage("tommy-podium-image", recap.weekId)
    }

    return NextResponse.json({
      success: true,
      stage: "prepare",
      week: recap.weekLabel,
      total_ballots: recap.totalBallots,
      top_three: recap.topThree,
      ai_model: recap.aiModel,
      chained: !skipChain && recap.topThree.length > 0,
    })
  } catch (error) {
    console.error("[cron/tommy-weekly-recap] Error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}
