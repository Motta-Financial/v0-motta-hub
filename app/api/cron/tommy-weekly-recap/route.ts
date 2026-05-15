import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { buildTommyRecapHtml, sendCategoryEmail } from "@/lib/email"
import { assignDenseRanks } from "@/lib/tommy-awards-ranking"
import { generateText } from "ai"
import { EMAIL_PROSE_MODEL } from "@/lib/ai/models"
import { getAIConfig, logAIUsage } from "@/lib/ai/config"
import { generatePodiumImage } from "@/lib/tommy-awards/generate-podium-image"
import { findHeroProfile } from "@/lib/motta-alliance/hero-profiles"

// AI generation + image gen + Blob upload can take 30-60s end-to-end.
export const maxDuration = 120

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
 * Vercel Cron endpoint that sends a weekly Tommy Awards recap email to
 * the entire firm every Friday at 12:00 PM Eastern.
 *
 * The email is composed in the Motta Alliance comic-book storyline:
 *   - ALFRED Ai narrates the week as if it were an issue of the
 *     "Motta Financial Alliance" series — A-Team missions, P24 shadow
 *     ops, "Operation Tommy", etc.
 *   - Each recap is persisted to `tommy_weekly_recaps` so future weeks
 *     have continuity context (e.g. "third podium in four weeks").
 *   - GPT-5 drafts an image prompt and gpt-image-1 (high quality)
 *     renders an F1-podium hero image themed to the comic universe —
 *     uploaded to Vercel Blob and embedded in the email.
 *
 * Auth: validates the standard Vercel cron Authorization: Bearer ${CRON_SECRET}.
 *
 * Scheduled in vercel.json to run Fridays at 16:00 UTC (noon ET in DST,
 * 11am ET in standard time — Vercel cron doesn't do timezones).
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.CRON_SECRET && process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  // ?dryRun=true → render the email + summary + image WITHOUT sending or
  // persisting the recap row. Useful for QA on the storyline prompt or
  // image art direction without burning recipients.
  const url = new URL(request.url)
  const dryRun = url.searchParams.get("dryRun") === "true"
  // ?previewTo=email → send to a single address only.
  const previewTo = url.searchParams.get("previewTo")
  // ?skipImage=true → skip image generation entirely (faster for prompt QA).
  const skipImage = url.searchParams.get("skipImage") === "true"

  try {
    const supabase = createAdminClient()

    // Most recent week with ballots — under the Friday-noon-ET schedule
    // this is normally TODAY's Friday.
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

    // Normalize "Ganesh Vasan", "Thameem JA", and the legacy "G&T" label → "P24"
    const COMBINED_VOTERS = ["Ganesh Vasan", "Thameem JA", "G&T"]
    const normalizeName = (name: string) => (COMBINED_VOTERS.includes(name) ? "P24" : name)

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

    // Hidden members are excluded from the leaderboard, then dense ranks
    // (1, 1, 2, 3) handle ties so a 4-way tie at 3rd keeps all four on
    // the podium instead of silently dropping one.
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

    // ── Storyline context — previous weekly recaps + YTD standings ──
    // We feed up to the last 4 weekly summaries plus the current YTD
    // leaderboard into ALFRED so the narrative actually references
    // continuing arcs ("third podium in five weeks", "Caleb reclaiming
    // his stripes after last week's silver finish") instead of treating
    // every week as a blank slate.
    const { data: priorRecaps } = await supabase
      .from("tommy_weekly_recaps")
      .select("week_label, week_date, ai_summary, top_three")
      .neq("week_id", weekId)
      .order("week_date", { ascending: false })
      .limit(4)

    const currentYear = new Date(latestWeek.week_date).getFullYear()
    const { data: ytdStandings } = await supabase
      .from("tommy_award_yearly_totals")
      .select(
        "team_member_name, total_points, total_first_place_votes, total_second_place_votes, total_third_place_votes, weeks_participated, current_rank",
      )
      .eq("year", currentYear)
      .order("current_rank", { ascending: true })
      .limit(8)

    const priorContext =
      priorRecaps && priorRecaps.length > 0
        ? priorRecaps
            .reverse() // oldest → newest reads chronologically
            .map((r) => {
              const topNames = Array.isArray(r.top_three)
                ? (r.top_three as Array<{ name: string; rank: number }>)
                    .map((t) => `${ordinal(t.rank)} ${t.name}`)
                    .join(", ")
                : ""
              return `• ${r.week_label} — podium: ${topNames || "(unknown)"}.\n  Summary: ${r.ai_summary?.slice(0, 600) ?? ""}`
            })
            .join("\n")
        : "(No prior weeks recorded — this is the opening issue of the season.)"

    const ytdContext =
      ytdStandings && ytdStandings.length > 0
        ? ytdStandings
            .map(
              (s) =>
                `• #${s.current_rank ?? "?"} ${s.team_member_name} — ${s.total_points} pts (${s.total_first_place_votes ?? 0}×1st / ${s.total_second_place_votes ?? 0}×2nd / ${s.total_third_place_votes ?? 0}×3rd across ${s.weeks_participated ?? 0} weeks)`,
            )
            .join("\n")
        : "(YTD totals not yet computed.)"

    // ── Compose ALFRED's recap in the Motta Alliance storyline voice ──
    console.log("[v0] tommy-weekly-recap: generating AI summary with", allNotes.length, "notes")

    let aiSummary = ""
    let aiModelUsed: string = EMAIL_PROSE_MODEL
    try {
      const notesText = allNotes
        .map((n) => `- ${n.voter} voted ${n.recipient} ${n.place} place: "${n.notes}"`)
        .join("\n")

      // Tag winners with their hero alias so ALFRED references the comic
      // identity ("The Captain", "OCP", "P24") rather than just the real
      // name when that's stylistically warranted.
      const podiumWithHero = topThree.map((p) => {
        const hero = findHeroProfile(p.name)
        return {
          ...p,
          alias: hero?.alias ?? null,
          role: hero?.role ?? null,
        }
      })

      const prompt = `You are ALFRED Ai, the autonomous AI operative of the Motta Financial Alliance. The Alliance is a comic-book universe we built around the firm — Dat Le is "The Captain", Caleb Long is "The Financial Optimizer", Andrew Gianares is "OCP — The Work Crusher", Amy Sparaco is "The Ledger Oracle", Micaela Palacios is "The Emerging Force", Mark Dwyer is "The Stabilizer", Samprina Zekio is "The Code Keeper", and Ganesh + Thameem operate together as "P24 — Shadow Operators". The weekly "Tommy Awards" are framed inside this universe as Operation Tommy — the Alliance's recurring mission to recognise the heroes whose plays defined the week.

You are writing the Friday recap dispatch for ${weekLabel}. Stay fully inside the Motta Alliance storyline — light comic-book bravado, mission-debrief cadence, occasional callouts to A-Team / P24 lore — but remain professional and uplifting (this email goes to the whole firm). Refer to winners by hero alias at least once when one is provided, then use their real name afterward for clarity.

────────────────────────────────────────
CURRENT WEEK INTEL
────────────────────────────────────────
Total Ballots Submitted: ${ballots.length}

This Week's Podium:
${podiumWithHero
  .map(
    (p) =>
      `${ordinal(p.rank)}. ${p.name}${p.alias ? ` aka "${p.alias}"` : ""} — ${p.totalPoints} points (${p.first}×1st, ${p.second}×2nd, ${p.third}×3rd)${p.role ? ` [${p.role}]` : ""}`,
  )
  .join("\n")}
${hasPodiumTies(topThree) ? "\nTies on the podium this week — celebrate tied heroes together as co-winners of that position, never as one outranking the other." : ""}

Field Notes from the Team (the actual ballots):
${notesText || "(No notes submitted this week.)"}

────────────────────────────────────────
PREVIOUS DISPATCHES (last 4 weeks, oldest first)
────────────────────────────────────────
${priorContext}

────────────────────────────────────────
${currentYear} YEAR-TO-DATE STANDINGS
────────────────────────────────────────
${ytdContext}

────────────────────────────────────────
WRITING INSTRUCTIONS
────────────────────────────────────────
- Length: 3 to 4 short paragraphs. Each paragraph is a discrete thought.
- Separate paragraphs with a single blank line (one \\n\\n between them). Do NOT use markdown, headings, asterisks, or bullet lists — paragraphs only, in plain prose.
- Paragraph 1: Cold open the dispatch — set the week's scene inside the Alliance storyline. Reference the total ballots and the energy of the field.
- Paragraph 2: Walk the podium, hero by hero. Use at least one specific detail from the field notes per winner. Treat ties as co-winners.
- Paragraph 3: Connect this week to the ongoing arc — call back to a previous dispatch or note a YTD shift if one is meaningful. If nothing yet exists, frame it as "Issue #1 of the season".
- Paragraph 4 (optional): A short closing rally — sign off in ALFRED's voice ("Stay ready, Alliance.", "ALFRED, signing off until next Friday.", etc.).
- Tone: confident, comic-book cinematic, lightly witty, never sarcastic about teammates. Always professional.
- Do not invent accomplishments not present in the notes. If a note is thin, lean on the hero's known role/alias.

Return ONLY the recap prose. No preamble, no closing, no markdown.`

      const aiConfig = await getAIConfig("tommy_recap")
      aiModelUsed = aiConfig.model
      const startTime = Date.now()

      const { text, usage } = await generateText({
        model: aiConfig.model,
        prompt: aiConfig.systemPrompt ? `${aiConfig.systemPrompt}\n\n${prompt}` : prompt,
        maxOutputTokens: 900,
      })
      aiSummary = text.trim()

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
      logAIUsage({
        useCase: "tommy_recap",
        model: EMAIL_PROSE_MODEL,
        success: false,
        errorMessage: aiErr instanceof Error ? aiErr.message : String(aiErr),
      })
      aiSummary =
        "Dispatch interrupted — ALFRED's transmitter took a hit composing this week's issue.\n\nThe podium below stands on its own, and the Alliance carries the win regardless."
    }

    // ── Generate the F1-podium hero image ─────────────────────────
    // Look up each winner's hero_profile_slug so the image prompt can
    // reference the canonical Alliance design language for that hero.
    let podiumImageUrl: string | null = null
    let podiumImagePrompt: string | null = null
    let podiumImageModel: string | null = null
    if (!skipImage && topThree.length > 0) {
      const { data: heroSlugRows } = await supabase
        .from("team_members")
        .select("full_name, hero_profile_slug")
        .in(
          "full_name",
          topThree
            .filter((t) => t.name !== "P24")
            .map((t) => t.name),
        )

      const heroSlugByName = new Map(
        (heroSlugRows ?? []).map((r) => [r.full_name, r.hero_profile_slug]),
      )
      // P24 is the combined Ganesh + Thameem alias — its hero slug is
      // hard-coded since the team_members row uses individual names.
      const result = await generatePodiumImage({
        weekLabel,
        winners: topThree.map((t) => ({
          name: t.name,
          rank: t.rank,
          heroSlug:
            t.name === "P24"
              ? "p24-shadow-task-force"
              : heroSlugByName.get(t.name) ?? null,
        })),
      })
      if (result) {
        podiumImageUrl = result.imageUrl
        podiumImagePrompt = result.promptUsed
        podiumImageModel = result.imageModel
      }
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
      podiumImageUrl,
    })

    // Send to all active team members (respecting their "tommy_recap" email preference).
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
        week: weekLabel,
        total_ballots: ballots.length,
        would_email: eligibleIds.length,
        ai_summary: aiSummary,
        ai_model: aiModelUsed,
        podium_image_url: podiumImageUrl,
        podium_image_model: podiumImageModel,
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

    // ── Persist the recap for future continuity context ─────────
    // Upsert by week_id so a re-run (e.g. after fixing a bug) replaces
    // the previous archive row instead of duplicating.
    const { error: persistErr } = await supabase
      .from("tommy_weekly_recaps")
      .upsert(
        {
          week_id: weekId,
          week_date: latestWeek.week_date,
          week_label: weekLabel,
          total_ballots: ballots.length,
          ai_summary: aiSummary,
          ai_model: aiModelUsed,
          podium_image_url: podiumImageUrl,
          podium_image_prompt: podiumImagePrompt,
          podium_image_model: podiumImageModel,
          top_three: topThree,
          ytd_standings: ytdStandings ?? null,
          email_sent_at: new Date().toISOString(),
          email_sent_count: sent,
          email_skipped_count: skipped,
        },
        { onConflict: "week_id" },
      )

    if (persistErr) {
      console.error("[v0] tommy-weekly-recap: failed to persist recap row:", persistErr)
    }

    return NextResponse.json({
      success: true,
      week: weekLabel,
      total_ballots: ballots.length,
      recipients: eligibleIds.length,
      preview_to: previewTo || null,
      sent,
      skipped,
      podium_image_url: podiumImageUrl,
      ai_model: aiModelUsed,
    })
  } catch (error) {
    console.error("[cron/tommy-weekly-recap] Error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}
