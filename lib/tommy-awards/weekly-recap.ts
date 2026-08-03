/**
 * Tommy Awards — Weekly Recap data composer (shared)
 * ───────────────────────────────────────────────────
 * This module owns the "fast brain work" of the Friday recap pipeline:
 * tallying the week's ballots into a dense-ranked podium and drafting
 * ALFRED Ai's Motta Alliance storyline summary.
 *
 * It is deliberately decoupled from PDF rendering, image generation, and
 * email sending so the pipeline can run as discrete, individually
 * time-budgeted stages:
 *
 *   1. PREPARE  (/api/cron/tommy-weekly-recap) — calls composeWeeklyRecap,
 *      persists the story columns, then chains to the image stage.
 *   2. IMAGE    (/api/cron/tommy-podium-image) — renders the podium art,
 *      then chains to the PDF stage.
 *   3. PDF      (/api/cron/tommy-recap-pdf) — builds the PDF with the
 *      image embedded.
 *   4. SEND     (/api/cron/tommy-recap-send) — noon-ET email with image +
 *      PDF. Also calls composeWeeklyRecap as a fallback if PREPARE never
 *      produced a row (so the firm always gets an email at noon).
 *
 * Keeping the tally + prose in one place means the PREPARE stage and the
 * SEND fallback can never drift apart.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { assignDenseRanks } from "@/lib/tommy-awards-ranking"
import { generateText } from "ai"
import { EMAIL_PROSE_MODEL } from "@/lib/ai/models"
import { getAIConfig, logAIUsage } from "@/lib/ai/config"
import { findHeroProfile } from "@/lib/motta-alliance/hero-profiles"

/** One podium finisher with dense rank + vote breakdown. */
export interface TopThreeEntry {
  name: string
  rank: number
  totalPoints: number
  first: number
  second: number
  third: number
}

/** Everything the downstream stages (image, pdf, email) need. */
export interface PreparedRecap {
  weekId: string
  /** ISO date string straight from `tommy_award_ballots.week_date`. */
  weekDate: string
  weekLabel: string
  topThree: TopThreeEntry[]
  totalBallots: number
  aiSummary: string
  aiModel: string
  ytdStandings: unknown
}

export type ComposeResult =
  | { status: "ok"; data: PreparedRecap }
  | { status: "skipped"; reason: string }

/**
 * Format a podium rank as "1st" / "2nd" / "3rd". Tied finishers share a
 * rank so the prompt reads "1st. Alex / 1st. Sam" rather than ordering
 * co-winners.
 */
export function ordinal(n: number): string {
  if (n === 1) return "1st"
  if (n === 2) return "2nd"
  if (n === 3) return "3rd"
  return `${n}th`
}

/**
 * True when any two podium finishers share the same rank — nudges
 * ALFRED's prompt to treat them as co-winners instead of one "edging
 * out" the other.
 */
export function hasPodiumTies(podium: ReadonlyArray<{ rank: number }>): boolean {
  const seen = new Set<number>()
  for (const p of podium) {
    if (seen.has(p.rank)) return true
    seen.add(p.rank)
  }
  return false
}

/**
 * Tally the most recent week's ballots into a podium and draft ALFRED's
 * storyline recap. Does NOT persist anything — the caller decides what to
 * write. Resolves to `{ status: "skipped" }` when there's nothing to
 * recap (no ballots yet).
 */
export async function composeWeeklyRecap(
  supabase: SupabaseClient,
): Promise<ComposeResult> {
  // Most recent week with ballots — under the Friday schedule this is
  // normally TODAY's Friday.
  const { data: latestWeek, error: weekErr } = await supabase
    .from("tommy_award_ballots")
    .select("week_id, week_date")
    .order("week_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (weekErr) throw weekErr
  if (!latestWeek) {
    return { status: "skipped", reason: "No ballots submitted yet — nothing to recap." }
  }

  const weekId = latestWeek.week_id as string
  const weekDate = new Date(latestWeek.week_date as string)
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
    return { status: "skipped", reason: `No ballots for week ${weekLabel} — nothing to recap.` }
  }

  // Normalize "Ganesh Vasan", "Thameem JA", and the legacy "G&T" → "P24"
  const COMBINED_VOTERS = ["Ganesh Vasan", "Thameem JA", "G&T"]
  const normalizeName = (name: string) => (COMBINED_VOTERS.includes(name) ? "P24" : name)

  const voteMap: Record<
    string,
    { first: number; second: number; third: number; totalPoints: number }
  > = {}
  const allNotes: Array<{ voter: string; place: string; recipient: string; notes: string }> = []

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
  // (1, 1, 2, 3) handle ties so a 4-way tie at 3rd keeps all four.
  const HIDDEN_MEMBERS = ["Grace Cha", "Beth Nietupski"]
  const sortedLeaderboard = Object.entries(voteMap)
    .filter(([name]) => !HIDDEN_MEMBERS.includes(name))
    .map(([name, stats]) => ({ name, ...stats }))
    .sort((a, b) => b.totalPoints - a.totalPoints)

  const rankedLeaderboard = assignDenseRanks(
    sortedLeaderboard,
    (a, b) => a.totalPoints === b.totalPoints,
  )

  const topThree = rankedLeaderboard.filter((entry) => entry.rank <= 3) as TopThreeEntry[]

  // ── Storyline context — previous recaps + YTD standings ──
  const { data: priorRecaps } = await supabase
    .from("tommy_weekly_recaps")
    .select("week_label, week_date, ai_summary, top_three")
    .neq("week_id", weekId)
    .order("week_date", { ascending: false })
    .limit(4)

  const currentYear = weekDate.getFullYear()
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
  console.log("[v0] tommy-recap-compose: generating AI summary with", allNotes.length, "notes")

  let aiSummary = ""
  let aiModelUsed: string = EMAIL_PROSE_MODEL
  try {
    const notesText = allNotes
      .map((n) => `- ${n.voter} voted ${n.recipient} ${n.place} place: "${n.notes}"`)
      .join("\n")

    const podiumWithHero = topThree.map((p) => {
      const hero = findHeroProfile(p.name)
      return { ...p, alias: hero?.alias ?? null, role: hero?.role ?? null }
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
    console.error("[v0] tommy-recap-compose: AI generation failed:", aiErr)
    logAIUsage({
      useCase: "tommy_recap",
      model: EMAIL_PROSE_MODEL,
      success: false,
      errorMessage: aiErr instanceof Error ? aiErr.message : String(aiErr),
    })
    aiSummary =
      "Dispatch interrupted — ALFRED's transmitter took a hit composing this week's issue.\n\nThe podium below stands on its own, and the Alliance carries the win regardless."
  }

  return {
    status: "ok",
    data: {
      weekId,
      weekDate: latestWeek.week_date as string,
      weekLabel,
      topThree,
      totalBallots: ballots.length,
      aiSummary,
      aiModel: aiModelUsed,
      ytdStandings: ytdStandings ?? null,
    },
  }
}
