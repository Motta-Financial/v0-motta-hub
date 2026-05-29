import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { buildTommyRecapHtml, sendCategoryEmail } from "@/lib/email"
import { composeWeeklyRecap, type TopThreeEntry } from "@/lib/tommy-awards/weekly-recap"
import { isEasternHourAndWeekday, nowInEastern } from "@/lib/cron-eastern"

// ── STAGE 4 of 4: SEND ────────────────────────────────────────────────
// Emails the firm the Friday Tommy recap at 12:00 PM Eastern, with the
// podium image embedded and the matching PDF attached.
//
// Crucially, this stage is triggered by its OWN noon-ET cron — NOT by the
// prep chain. That makes it a safety net: the prep chain (PREPARE → IMAGE
// → PDF) starts at 8:45 AM ET, so by noon the image + PDF are normally
// ready and baked into the recap row. But even if a prep stage failed:
//   - If the row has a story but no image/PDF, the email still ships
//     (with whatever is present).
//   - If PREPARE never ran at all, we compose the recap inline here so
//     the firm is never left without a Friday email.
//
// Composing inline is fast (~10s); we only render the email + send, so a
// tight ceiling is fine.
export const maxDuration = 60

/**
 * Vercel Cron endpoint — Friday 12:00 PM Eastern. Scheduled at BOTH UTC
 * hours that map to noon Eastern:
 *   - `0 16 * * 5` — 16:00 UTC = 12:00 PM EDT (Mar–Nov)
 *   - `0 17 * * 5` — 17:00 UTC = 12:00 PM EST (Nov–Mar)
 * The `isEasternHourAndWeekday(12, 5)` guard lets exactly one twin send.
 *
 * Query flags:
 *   - ?dryRun=true     — render + return the email WITHOUT sending/persisting.
 *   - ?previewTo=email — send to a single address only (bypasses guard).
 *   - ?force=true      — bypass the Eastern-time guard.
 *   - ?resend=true     — send even if email_sent_at is already set.
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
  const previewTo = url.searchParams.get("previewTo")
  const force = url.searchParams.get("force") === "true"
  const resend = url.searchParams.get("resend") === "true"

  // DST guard: only send at noon ET on a Friday. The other UTC-twin
  // invocation exits cleanly here. QA flags bypass the guard.
  if (!dryRun && !previewTo && !force && !isEasternHourAndWeekday(12, 5)) {
    const { hour, weekday } = nowInEastern()
    return NextResponse.json({
      success: true,
      skipped: true,
      reason: "Not 12:00 PM Eastern on a Friday — skipping (DST twin invocation).",
      eastern_hour: hour,
      eastern_weekday: weekday,
    })
  }

  try {
    const supabase = createAdminClient()

    // The week to send is the most recent week with ballots.
    const { data: latestWeek, error: weekErr } = await supabase
      .from("tommy_award_ballots")
      .select("week_id, week_date")
      .order("week_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (weekErr) throw weekErr
    if (!latestWeek) {
      return NextResponse.json({
        success: true,
        skipped: true,
        message: "No ballots submitted yet — nothing to send.",
      })
    }

    const weekId = latestWeek.week_id as string

    // Load whatever the prep chain produced.
    let { data: recap } = await supabase
      .from("tommy_weekly_recaps")
      .select(
        "week_id, week_label, ai_summary, ai_model, top_three, total_ballots, podium_image_url, podium_pdf_url, ytd_standings, email_sent_at",
      )
      .eq("week_id", weekId)
      .maybeSingle()

    // Idempotency: don't double-send unless explicitly asked.
    if (recap?.email_sent_at && !resend && !previewTo && !dryRun) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: "Recap already emailed for this week.",
        email_sent_at: recap.email_sent_at,
      })
    }

    // Fallback: PREPARE never produced a usable row → compose inline so
    // the firm still gets an email at noon (without image/PDF).
    if (!recap || !recap.ai_summary) {
      console.warn(
        "[v0] tommy-recap-send: no prepared recap for week",
        weekId,
        "— composing inline fallback (no image/PDF).",
      )
      const composed = await composeWeeklyRecap(supabase)
      if (composed.status === "skipped") {
        return NextResponse.json({ success: true, skipped: true, message: composed.reason })
      }
      const c = composed.data
      const { error: persistErr } = await supabase.from("tommy_weekly_recaps").upsert(
        {
          week_id: c.weekId,
          week_date: c.weekDate,
          week_label: c.weekLabel,
          total_ballots: c.totalBallots,
          ai_summary: c.aiSummary,
          ai_model: c.aiModel,
          top_three: c.topThree,
          ytd_standings: c.ytdStandings,
        },
        { onConflict: "week_id" },
      )
      if (persistErr) {
        console.error("[v0] tommy-recap-send: fallback persist failed:", persistErr)
      }
      recap = {
        week_id: c.weekId,
        week_label: c.weekLabel,
        ai_summary: c.aiSummary,
        ai_model: c.aiModel,
        top_three: c.topThree,
        total_ballots: c.totalBallots,
        podium_image_url: null,
        podium_pdf_url: null,
        ytd_standings: c.ytdStandings,
        email_sent_at: null,
      }
    }

    const weekLabel = recap.week_label as string
    const topThree = (recap.top_three ?? []) as TopThreeEntry[]
    const podiumImageUrl = (recap.podium_image_url as string | null) ?? null
    const podiumPdfUrl = (recap.podium_pdf_url as string | null) ?? null

    // Build the email HTML with the podium image embedded.
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://hub.motta.cpa"
    const html = buildTommyRecapHtml({
      weekLabel,
      aiSummary: (recap.ai_summary as string) ?? "",
      topThree,
      totalBallots: (recap.total_ballots as number) ?? 0,
      leaderboardUrl: `${appUrl}/tommy-awards`,
      podiumImageUrl,
    })

    // Recipients: active team members with the tommy_recap preference.
    const { data: allMembers, error: membersErr } = await supabase
      .from("team_members")
      .select("id, full_name, email")
      .eq("is_active", true)

    if (membersErr) throw membersErr

    let eligibleMembers = (allMembers || []).filter((m) => m.email)
    if (previewTo) {
      eligibleMembers = eligibleMembers.filter(
        (m) => m.email?.toLowerCase() === previewTo.toLowerCase(),
      )
    }
    const eligibleIds = eligibleMembers.map((m) => m.id)

    if (dryRun) {
      return NextResponse.json({
        success: true,
        dry_run: true,
        stage: "send",
        week: weekLabel,
        would_email: eligibleIds.length,
        has_image: Boolean(podiumImageUrl),
        has_pdf: Boolean(podiumPdfUrl),
        podium_image_url: podiumImageUrl,
        podium_pdf_url: podiumPdfUrl,
        html,
      })
    }

    // Attach the recap PDF via its public Blob URL (Resend fetches it).
    const attachments = podiumPdfUrl
      ? [
          {
            filename: `Tommy-Awards-Recap-${weekLabel.replace(/[^a-zA-Z0-9]+/g, "-")}.pdf`,
            path: podiumPdfUrl,
            contentType: "application/pdf",
          },
        ]
      : undefined

    const { sent, skipped } = await sendCategoryEmail({
      category: "tommy_recap",
      teamMemberIds: eligibleIds,
      subject: `Tommy Awards Recap — Week of ${weekLabel}`,
      html,
      attachments,
    })

    // Mark as sent (skip when this was only a single-address preview so a
    // preview doesn't block the real Friday send).
    if (!previewTo) {
      const { error: markErr } = await supabase
        .from("tommy_weekly_recaps")
        .update({
          email_sent_at: new Date().toISOString(),
          email_sent_count: sent,
          email_skipped_count: skipped,
        })
        .eq("week_id", weekId)
      if (markErr) {
        console.error("[v0] tommy-recap-send: failed to mark sent:", markErr)
      }
    }

    return NextResponse.json({
      success: true,
      stage: "send",
      week: weekLabel,
      recipients: eligibleIds.length,
      preview_to: previewTo || null,
      sent,
      skipped,
      had_image: Boolean(podiumImageUrl),
      had_pdf: Boolean(podiumPdfUrl),
    })
  } catch (error) {
    console.error("[cron/tommy-recap-send] Error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}
