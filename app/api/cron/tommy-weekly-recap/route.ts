import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { sendCategoryEmail } from "@/lib/email"
import { generateText } from "ai"

// AI generation can take 10-30s with a long prompt; bump from the default 10s.
export const maxDuration = 60

/**
 * Vercel Cron endpoint that sends a weekly Tommy Awards recap email to the
 * entire firm every Monday at 12:00 PM Eastern Time.
 *
 * The email:
 *   - Recaps the previous week's Tommy Awards voting results
 *   - Uses AI to analyze all the ballot notes and write a witty summary
 *   - Written by "ALFRED Ai" in the tone of an old British butler
 *   - Includes vote tallies and highlights the week's winners
 *
 * Auth: validates the standard Vercel cron Authorization: Bearer ${CRON_SECRET} header.
 *
 * Scheduled in vercel.json to run Mondays at 16:00 UTC, which is:
 *   - 12:00 PM EDT (March-November, ~8 months/year)
 *   - 11:00 AM EST (November-March, ~4 months/year)
 * Vercel Cron doesn't support timezone-aware schedules; we optimize for the
 * longer Daylight Saving period to hit noon Eastern most of the year.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.CRON_SECRET && process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  // Pass ?dryRun=true to render the email + run the AI summary WITHOUT sending
  // to recipients. Useful for testing changes to the prompt or layout without
  // blasting the entire firm. Returns the rendered HTML in the response.
  const url = new URL(request.url)
  const dryRun = url.searchParams.get("dryRun") === "true"
  // Optional ?previewTo=email@example.com — sends ONLY to that address (for QA).
  const previewTo = url.searchParams.get("previewTo")

  try {
    const supabase = createAdminClient()

    // Get the most recent week that has ballots submitted.
    // We recap the PREVIOUS week (week_date is Friday; email sends Monday).
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
        message: "No ballots submitted yet — nothing to recap.",
      })
    }

    const weekId = latestWeek.week_id
    const weekDate = new Date(latestWeek.week_date)
    const weekLabel = weekDate.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    })

    // Fetch all ballots for this week including all the notes.
    const { data: ballots, error: ballotsErr } = await supabase
      .from("tommy_award_ballots")
      .select("*")
      .eq("week_id", weekId)
      .order("voter_name")

    if (ballotsErr) throw ballotsErr
    if (!ballots || ballots.length === 0) {
      return NextResponse.json({
        success: true,
        skipped: true,
        message: `No ballots for week ${weekLabel} — nothing to recap.`,
      })
    }

    // Normalize "Ganesh Vasan" and "Thameem JA" → "G&T" for aggregation
    const COMBINED_VOTERS = ["Ganesh Vasan", "Thameem JA"]
    const normalizeName = (name: string) => (COMBINED_VOTERS.includes(name) ? "G&T" : name)

    // Aggregate vote tallies and collect all notes for AI summarization.
    const voteMap: Record<
      string,
      {
        first: number
        second: number
        third: number
        totalPoints: number
      }
    > = {}
    const allNotes: Array<{
      voter: string
      place: string
      recipient: string
      notes: string
    }> = []

    const ensureEntry = (name: string) => {
      const normalized = normalizeName(name)
      if (!voteMap[normalized]) {
        voteMap[normalized] = { first: 0, second: 0, third: 0, totalPoints: 0 }
      }
      return voteMap[normalized]
    }

    for (const ballot of ballots) {
      if (ballot.first_place_name) {
        const entry = ensureEntry(ballot.first_place_name)
        entry.first++
        entry.totalPoints += 3
        if (ballot.first_place_notes) {
          allNotes.push({
            voter: ballot.voter_name,
            place: "1st",
            recipient: ballot.first_place_name,
            notes: ballot.first_place_notes,
          })
        }
      }
      if (ballot.second_place_name) {
        const entry = ensureEntry(ballot.second_place_name)
        entry.second++
        entry.totalPoints += 2
        if (ballot.second_place_notes) {
          allNotes.push({
            voter: ballot.voter_name,
            place: "2nd",
            recipient: ballot.second_place_name,
            notes: ballot.second_place_notes,
          })
        }
      }
      if (ballot.third_place_name) {
        const entry = ensureEntry(ballot.third_place_name)
        entry.third++
        entry.totalPoints += 1
        if (ballot.third_place_notes) {
          allNotes.push({
            voter: ballot.voter_name,
            place: "3rd",
            recipient: ballot.third_place_name,
            notes: ballot.third_place_notes,
          })
        }
      }
    }

    // Exclude hidden members from the final leaderboard.
    const HIDDEN_MEMBERS = ["Grace Cha", "Beth Nietupski"]
    const leaderboard = Object.entries(voteMap)
      .filter(([name]) => !HIDDEN_MEMBERS.includes(name))
      .sort(([, a], [, b]) => b.totalPoints - a.totalPoints)

    const topThree = leaderboard.slice(0, 3).map(([name, stats]) => ({
      name,
      ...stats,
    }))

    // Use AI (via AI SDK 6 + Vercel AI Gateway) to write a witty weekly recap
    // in ALFRED's voice: an old British butler — witty yet professional.
    console.log("[v0] tommy-weekly-recap: generating AI summary with", allNotes.length, "notes")

    let aiSummary = ""
    try {
      const notesText = allNotes
        .map((n) => `- ${n.voter} voted ${n.recipient} ${n.place} place: "${n.notes}"`)
        .join("\n")

      const prompt = `You are ALFRED Ai, the distinguished AI butler at Motta Financial. Write a weekly recap for the firm's "Tommy Awards" — a program where team members vote for colleagues who exemplified excellence, went above and beyond, or had client wins that week (inspired by Tom Brady's pursuit of greatness).

**Week:** ${weekLabel}
**Total Ballots Submitted:** ${ballots.length}

**Top 3 Finishers:**
${topThree.map((p, i) => `${i + 1}. ${p.name} — ${p.totalPoints} points (${p.first} first-place, ${p.second} second-place, ${p.third} third-place votes)`).join("\n")}

**All Ballot Notes from the Team:**
${notesText || "(No notes submitted this week.)"}

---

Write a 2-3 paragraph recap in your signature tone: witty, charming, slightly cheeky but always professional and uplifting. Celebrate the winners, highlight memorable accomplishments mentioned in the notes, and inject just enough British butler flair (e.g., "One observes...", "Indeed, quite the showing...") to make it fun without being over-the-top. Keep it concise — this is a firm-wide email. Do NOT use markdown formatting or headings — write in plain prose suitable for an HTML email body.`

      const { text } = await generateText({
        model: "openai/gpt-4o",
        prompt,
        // AI SDK 6: token cap parameter is `maxOutputTokens` (renamed from `maxTokens` in v5).
        maxOutputTokens: 600,
      })
      aiSummary = text.trim()
    } catch (aiErr) {
      console.error("[v0] tommy-weekly-recap: AI generation failed:", aiErr)
      aiSummary =
        "I regret to inform you that my circuits experienced a momentary disruption whilst composing this week's recap. One does hope you'll forgive the lapse and simply refer to the results below."
    }

    // Build the email HTML
    const html = buildTommyRecapEmailHtml({
      weekLabel,
      aiSummary,
      topThree,
      totalBallots: ballots.length,
    })

    // Send to all active team members (respecting their "tommy_recap" email preference).
    const { data: allMembers, error: membersErr } = await supabase
      .from("team_members")
      .select("id, full_name, email")
      .eq("is_active", true)

    if (membersErr) throw membersErr

    let eligibleMembers = (allMembers || []).filter((m) => m.email)

    // ?previewTo=foo@example.com narrows recipients to just one team_member by email.
    if (previewTo) {
      eligibleMembers = eligibleMembers.filter(
        (m) => m.email?.toLowerCase() === previewTo.toLowerCase(),
      )
    }

    const eligibleIds = eligibleMembers.map((m) => m.id)

    if (dryRun) {
      // Don't actually send — return the rendered HTML + AI summary for review.
      return NextResponse.json({
        success: true,
        dry_run: true,
        week: weekLabel,
        total_ballots: ballots.length,
        would_email: eligibleIds.length,
        ai_summary: aiSummary,
        top_three: topThree,
        html,
      })
    }

    const { sent, skipped } = await sendCategoryEmail({
      category: "tommy_recap",
      teamMemberIds: eligibleIds,
      subject: `Tommy Awards Recap — Week of ${weekLabel}`,
      html,
    })

    return NextResponse.json({
      success: true,
      week: weekLabel,
      total_ballots: ballots.length,
      recipients: eligibleIds.length,
      preview_to: previewTo || null,
      sent,
      skipped,
    })
  } catch (error) {
    console.error("[cron/tommy-weekly-recap] Error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}

// Helper: build the weekly recap email HTML with ALFRED branding.
function buildTommyRecapEmailHtml(opts: {
  weekLabel: string
  aiSummary: string
  topThree: Array<{
    name: string
    totalPoints: number
    first: number
    second: number
    third: number
  }>
  totalBallots: number
}) {
  const topThreeHtml =
    opts.topThree.length > 0
      ? opts.topThree
          .map(
            (winner, i) => `
        <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 12px;">
          <div style="
            background: ${i === 0 ? "#FFD700" : i === 1 ? "#C0C0C0" : "#CD7F32"};
            color: #1a1a1a;
            font-size: 20px;
            font-weight: 700;
            width: 48px;
            height: 48px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
          ">${i + 1}</div>
          <div style="flex: 1;">
            <div style="font-size: 17px; font-weight: 600; color: #1a1a1a; margin-bottom: 2px;">
              ${winner.name}
            </div>
            <div style="font-size: 13px; color: #666;">
              ${winner.totalPoints} points &nbsp;·&nbsp; ${winner.first} first-place, ${winner.second} second-place, ${winner.third} third-place
            </div>
          </div>
        </div>
      `,
          )
          .join("")
      : `<p style="color:#888;font-size:14px;">No votes recorded this week.</p>`

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;">
  <div style="max-width:640px;margin:0 auto;padding:24px;">
    <div style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <!-- Header -->
      <div style="background:#1a1a1a;padding:28px 32px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
          <div style="background:#c62828;color:#fff;font-size:20px;font-weight:700;width:40px;height:40px;border-radius:8px;display:flex;align-items:center;justify-content:center;">
            T
          </div>
          <h1 style="color:#fff;font-size:22px;margin:0;">Tommy Awards Weekly Recap</h1>
        </div>
        <p style="color:#a3a3a3;font-size:14px;margin:0;">Week of ${opts.weekLabel}</p>
      </div>

      <!-- Body -->
      <div style="padding:32px;">
        <!-- AI-powered summary from ALFRED -->
        <div style="background:#f9fafb;border-left:4px solid #1a1a1a;padding:20px;border-radius:8px;margin-bottom:28px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
            <div style="font-size:24px;">🎩</div>
            <div style="font-weight:600;font-size:15px;color:#1a1a1a;">From ALFRED Ai</div>
          </div>
          <div style="font-size:15px;color:#333;line-height:1.7;white-space:pre-wrap;">${opts.aiSummary}</div>
        </div>

        <!-- Top 3 Finishers -->
        <h2 style="font-size:18px;color:#1a1a1a;margin:0 0 16px;">Top 3 Finishers</h2>
        ${topThreeHtml}

        <!-- Stats -->
        <div style="background:#f9fafb;border-radius:8px;padding:16px;margin-top:24px;">
          <div style="font-size:13px;color:#666;display:flex;justify-content:space-between;">
            <span>Total Ballots Submitted</span>
            <span style="font-weight:600;color:#1a1a1a;">${opts.totalBallots}</span>
          </div>
        </div>

        <!-- CTA -->
        <div style="margin-top:28px;text-align:center;">
          <a href="${process.env.NEXT_PUBLIC_APP_URL || "https://motta.cpa"}/tommy-awards"
             style="display:inline-block;background:#c62828;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">
            View Full Leaderboard
          </a>
        </div>
      </div>

      <!-- Footer -->
      <div style="background:#f9fafb;padding:16px 32px;border-top:1px solid #eee;">
        <p style="font-size:12px;color:#999;margin:0;text-align:center;">
          This recap is generated by ALFRED Ai and sent weekly. Manage your email preferences in settings.
        </p>
      </div>
    </div>
  </div>
</body>
</html>`
}
