import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { buildTommyRecapHtml, sendCategoryEmail } from "@/lib/email"
import { assignDenseRanks } from "@/lib/tommy-awards-ranking"
import { generateText } from "ai"
import { EMAIL_PROSE_MODEL } from "@/lib/ai/models"
import { getAIConfig, logAIUsage } from "@/lib/ai/config"

// AI generation can take 10-30s with a long prompt; bump from the default 10s.
export const maxDuration = 60

/**
 * Format a podium rank as "1st" / "2nd" / "3rd". Tied finishers share a
 * rank so we want the prompt to read "1st. Alex / 1st. Sam" rather than
 * "1. Alex / 2. Sam", which would mislead ALFRED into ordering them.
 */
function ordinal(n: number): string {
  if (n === 1) return "1st"
  if (n === 2) return "2nd"
  if (n === 3) return "3rd"
  return `${n}th`
}

/**
 * True when any two podium finishers share the same rank — used to nudge
 * ALFRED's prompt with explicit guidance about co-winners so the recap
 * doesn't accidentally describe one tied colleague as "edging out" the
 * other.
 */
function hasPodiumTies(podium: ReadonlyArray<{ rank: number }>): boolean {
  const seen = new Set<number>()
  for (const p of podium) {
    if (seen.has(p.rank)) return true
    seen.add(p.rank)
  }
  return false
}

/**
 * Vercel Cron endpoint that sends a weekly Tommy Awards recap email to the
 * entire firm every Friday at 12:00 PM Eastern Time, immediately after the
 * Thursday-afternoon ballot reminder closes out the voting window.
 *
 * The email:
 *   - Recaps THIS week's Tommy Awards voting results
 *   - Uses AI to analyze all the ballot notes and write a witty summary
 *   - Written by "ALFRED Ai" in the tone of an old British butler
 *   - Includes vote tallies and highlights the week's winners
 *   - Renders through the shared baseEmailWrapper in lib/email.ts so the
 *     header/footer/palette match every other Motta Hub transactional email
 *
 * Auth: validates the standard Vercel cron Authorization: Bearer ${CRON_SECRET} header.
 *
 * Scheduled in vercel.json to run Fridays at 16:00 UTC, which is:
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

    // Get the most recent week that has ballots submitted. With the new
    // schedule (recap fires Friday at noon ET, after the Thursday-afternoon
    // reminder) the most recent week_date will normally be TODAY's Friday —
    // i.e. we recap THIS week's votes. If somehow no votes came in for
    // today, this falls back to whichever week last had ballots.
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

    // Exclude hidden members from the final leaderboard, then assign
    // dense ranks (1, 1, 2, 3) so ties at any podium position share a
    // rank instead of pushing the next-best finisher off the podium.
    // Filtering to `rank <= 3` (instead of `slice(0, 3)`) means a
    // four-way tie at 3rd place includes ALL four members in the
    // recap — nobody on a podium-tied week silently drops out.
    const HIDDEN_MEMBERS = ["Grace Cha", "Beth Nietupski"]
    const sortedLeaderboard = Object.entries(voteMap)
      .filter(([name]) => !HIDDEN_MEMBERS.includes(name))
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.totalPoints - a.totalPoints)

    const rankedLeaderboard = assignDenseRanks(
      sortedLeaderboard,
      (a, b) => a.totalPoints === b.totalPoints,
    )

    const topThree = rankedLeaderboard.filter((entry) => entry.rank <= 3)

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

**Podium Finishers:**
${topThree.map((p) => `${ordinal(p.rank)}. ${p.name} — ${p.totalPoints} points (${p.first} first-place, ${p.second} second-place, ${p.third} third-place votes)`).join("\n")}
${hasPodiumTies(topThree) ? "\nNote: Some finishers are tied. When two or more colleagues share a position (e.g. both 1st), please celebrate them together as co-winners of that position rather than treating one as outranking the other." : ""}

**All Ballot Notes from the Team:**
${notesText || "(No notes submitted this week.)"}

---

Write a 2-3 paragraph recap in your signature tone: witty, charming, slightly cheeky but always professional and uplifting. Celebrate the winners, highlight memorable accomplishments mentioned in the notes, and inject just enough British butler flair (e.g., "One observes...", "Indeed, quite the showing...") to make it fun without being over-the-top. Keep it concise — this is a firm-wide email. Do NOT use markdown formatting or headings — write in plain prose suitable for an HTML email body.`

      // Fetch AI config for model override from the admin panel
      const aiConfig = await getAIConfig("tommy_recap")
      const startTime = Date.now()

      const { text, usage } = await generateText({
        model: aiConfig.model,
        prompt: aiConfig.systemPrompt ? `${aiConfig.systemPrompt}\n\n${prompt}` : prompt,
        // AI SDK 6: token cap parameter is `maxOutputTokens` (renamed from `maxTokens` in v5).
        maxOutputTokens: 600,
      })
      aiSummary = text.trim()

      // Log usage for the admin stats dashboard
      // AI SDK 6 uses inputTokens/outputTokens; we map to our DB schema names
      logAIUsage({
        useCase: "tommy_recap",
        model: aiConfig.model,
        promptTokens: usage?.inputTokens,
        completionTokens: usage?.outputTokens,
        totalTokens: usage?.totalTokens,
        latencyMs: Date.now() - startTime,
        success: true,
      })
    } catch (aiErr) {
      console.error("[v0] tommy-weekly-recap: AI generation failed:", aiErr)
      // Log failed attempt
      logAIUsage({
        useCase: "tommy_recap",
        model: EMAIL_PROSE_MODEL,
        success: false,
        errorMessage: aiErr instanceof Error ? aiErr.message : String(aiErr),
      })
      aiSummary =
        "I regret to inform you that my circuits experienced a momentary disruption whilst composing this week's recap. One does hope you'll forgive the lapse and simply refer to the results below."
    }

    // Build the email HTML using the shared MOTTA HUB wrapper so the header,
    // footer, and brand palette match the Thursday reminder email exactly.
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://motta.cpa"
    const html = buildTommyRecapHtml({
      weekLabel,
      aiSummary,
      topThree,
      totalBallots: ballots.length,
      leaderboardUrl: `${appUrl}/tommy-awards`,
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


