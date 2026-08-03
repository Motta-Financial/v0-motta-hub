/**
 * Backfill `tommy_weekly_recaps.ai_summary` for every 2026 week that
 * already happened but never produced a recap row (because the recap
 * cron didn't exist yet, or earlier weeks pre-dated the rollout).
 *
 * Why: ALFRED's Friday recap prompt feeds the previous 4 weekly
 * summaries forward as continuity context ("third podium in five
 * weeks", etc). With the prior weeks empty, every recap reads as
 * "Issue #1 of the season". Backfilling closes that gap.
 *
 * What this script DOES:
 *   - Walks 2026 weeks chronologically (oldest → newest) so each
 *     subsequent prompt sees the summaries we just wrote.
 *   - Re-creates the same podium aggregation the cron does
 *     (P24 normalisation, hidden members, dense ranks for ties).
 *   - Calls Claude Haiku 4.5 via the Vercel AI Gateway with the
 *     same ALFRED storyline prompt the cron uses.
 *   - Upserts `tommy_weekly_recaps` with ai_summary + top_three +
 *     ballot count etc.
 *
 * What this script DOES NOT DO:
 *   - No email send, no PDF, no podium image. Image generation is
 *     intentionally skipped per the operator's directive — the
 *     summaries alone restore ALFRED's continuity context.
 *   - No clobbering of weeks that already have a recap row (5/15
 *     and 5/22 stay as-is).
 *
 * Run:
 *   node --env-file=/tmp/.env.prod scripts/backfill-tommy-weekly-summaries.mjs [--force] [--dry-run]
 *     --force     re-generate even weeks that already have a summary
 *     --dry-run   print everything but don't write to Supabase
 */
import { createClient } from "@supabase/supabase-js"
import { generateText } from "ai"

const FORCE = process.argv.includes("--force")
const DRY_RUN = process.argv.includes("--dry-run")
const LIMIT_ARG = process.argv.find((a) => a.startsWith("--limit="))
const LIMIT = LIMIT_ARG ? Number.parseInt(LIMIT_ARG.split("=")[1], 10) : null
const MODEL = "anthropic/claude-haiku-4.5"

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const AI_GATEWAY_API_KEY = process.env.AI_GATEWAY_API_KEY
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// ── Hero profiles for ALFRED storyline tagging ────────────────────────
// Keep this in sync with `lib/motta-alliance/hero-profiles.ts`. We
// inline a minimal lookup here to avoid TS imports from a .mjs script.
const HERO_PROFILES = {
  "Dat Le": { alias: "The Captain", role: "Founding partner / firm strategist" },
  "Caleb Long": { alias: "The Financial Optimizer", role: "Senior tax strategist" },
  "Andrew Gianares": { alias: "OCP — The Work Crusher", role: "Production lead" },
  "Amy Sparaco": { alias: "The Ledger Oracle", role: "Bookkeeping operations" },
  "Micaela Palacios": { alias: "The Emerging Force", role: "Junior accountant on the rise" },
  "Mark Dwyer": { alias: "The Stabilizer", role: "Operations + project lead" },
  "Samprina Zekio": { alias: "The Code Keeper", role: "Systems / automation engineer" },
  P24: { alias: "P24 — Shadow Operators", role: "Offshore production duo (Ganesh + Thameem)" },
}

const HIDDEN_MEMBERS = ["Grace Cha", "Beth Nietupski"]
const COMBINED_VOTERS = ["Ganesh Vasan", "Thameem JA", "G&T"]
const normalizeName = (n) => (COMBINED_VOTERS.includes(n) ? "P24" : n)

const ordinal = (n) =>
  n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`

function assignDenseRanks(items) {
  const out = []
  let lastPoints = null
  let rank = 0
  for (const item of items) {
    if (item.totalPoints !== lastPoints) {
      rank += 1
      lastPoints = item.totalPoints
    }
    out.push({ ...item, rank })
  }
  return out
}

function hasPodiumTies(podium) {
  const seen = new Set()
  for (const p of podium) {
    if (seen.has(p.rank)) return true
    seen.add(p.rank)
  }
  return false
}

async function summariseWeek(week, allBallots) {
  const ballots = allBallots.filter((b) => b.week_id === week.id)
  if (ballots.length === 0) {
    console.log(`  · ${week.week_date} — 0 ballots, skipping`)
    return { skipped: true, reason: "no ballots" }
  }

  // ── Aggregate votes ─────────────────────────────────────────────
  const voteMap = {}
  const allNotes = []
  const ensure = (name) => {
    const k = normalizeName(name)
    if (!voteMap[k]) voteMap[k] = { first: 0, second: 0, third: 0, totalPoints: 0 }
    return voteMap[k]
  }
  for (const b of ballots) {
    if (b.first_place_name) {
      const e = ensure(b.first_place_name)
      e.first++
      e.totalPoints += 3
      if (b.first_place_notes)
        allNotes.push({ voter: b.voter_name, place: "1st", recipient: b.first_place_name, notes: b.first_place_notes })
    }
    if (b.second_place_name) {
      const e = ensure(b.second_place_name)
      e.second++
      e.totalPoints += 2
      if (b.second_place_notes)
        allNotes.push({ voter: b.voter_name, place: "2nd", recipient: b.second_place_name, notes: b.second_place_notes })
    }
    if (b.third_place_name) {
      const e = ensure(b.third_place_name)
      e.third++
      e.totalPoints += 1
      if (b.third_place_notes)
        allNotes.push({ voter: b.voter_name, place: "3rd", recipient: b.third_place_name, notes: b.third_place_notes })
    }
  }

  const sorted = Object.entries(voteMap)
    .filter(([n]) => !HIDDEN_MEMBERS.includes(n))
    .map(([name, s]) => ({ name, ...s }))
    .sort((a, b) => b.totalPoints - a.totalPoints)

  const ranked = assignDenseRanks(sorted)
  const topThree = ranked.filter((r) => r.rank <= 3)

  if (topThree.length === 0) {
    console.log(`  · ${week.week_date} — no podium after filters, skipping`)
    return { skipped: true, reason: "no podium" }
  }

  // ── Continuity context: last 4 prior recaps + YTD standings ──────
  const { data: priorRecaps } = await supabase
    .from("tommy_weekly_recaps")
    .select("week_label, week_date, ai_summary, top_three")
    .lt("week_date", week.week_date)
    .order("week_date", { ascending: false })
    .limit(4)

  const currentYear = new Date(week.week_date).getFullYear()
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
          .reverse()
          .map((r) => {
            const topNames = Array.isArray(r.top_three)
              ? r.top_three.map((t) => `${ordinal(t.rank)} ${t.name}`).join(", ")
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

  const podiumWithHero = topThree.map((p) => ({
    ...p,
    alias: HERO_PROFILES[p.name]?.alias ?? null,
    role: HERO_PROFILES[p.name]?.role ?? null,
  }))

  const weekDate = new Date(week.week_date)
  const weekLabel = weekDate.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })

  const notesText = allNotes
    .map((n) => `- ${n.voter} voted ${n.recipient} ${n.place} place: "${n.notes}"`)
    .join("\n")

  const prompt = `You are ALFRED Ai, the autonomous AI operative of the Motta Financial Alliance. The Alliance is a comic-book universe we built around the firm — Dat Le is "The Captain", Caleb Long is "The Financial Optimizer", Andrew Gianares is "OCP — The Work Crusher", Amy Sparaco is "The Ledger Oracle", Micaela Palacios is "The Emerging Force", Mark Dwyer is "The Stabilizer", Samprina Zekio is "The Code Keeper", and Ganesh + Thameem operate together as "P24 — Shadow Operators". The weekly "Tommy Awards" are framed inside this universe as Operation Tommy — the Alliance's recurring mission to recognise the heroes whose plays defined the week.

You are writing the Friday recap dispatch for ${weekLabel}. Stay fully inside the Motta Alliance storyline — light comic-book bravado, mission-debrief cadence, occasional callouts to A-Team / P24 lore — but remain professional and uplifting (this email goes to the whole firm). Refer to winners by hero alias at least once when one is provided, then use their real name afterward for clarity.

NOTE: this dispatch is being assembled retroactively from the archive — write it as if it were the original Friday issue from that week, not as a backwards-looking note.

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

  const startTime = Date.now()
  const { text } = await generateText({
    model: MODEL,
    prompt,
    maxOutputTokens: 900,
  })
  const aiSummary = text.trim()
  const latencyMs = Date.now() - startTime

  const rowToUpsert = {
    week_id: week.id,
    week_date: week.week_date,
    week_label: weekLabel,
    total_ballots: ballots.length,
    ai_summary: aiSummary,
    ai_model: MODEL,
    top_three: topThree,
    ytd_standings: ytdStandings ?? null,
    // Image / PDF / email columns intentionally untouched.
  }

  if (!DRY_RUN) {
    const { error: upErr } = await supabase
      .from("tommy_weekly_recaps")
      .upsert(rowToUpsert, { onConflict: "week_id" })
    if (upErr) throw upErr
  }

  console.log(
    `  ✓ ${week.week_date} — ${ballots.length} ballots, podium=[${topThree.map((t) => `${ordinal(t.rank)} ${t.name}`).join(", ")}], ${latencyMs}ms${DRY_RUN ? " (dry-run)" : ""}`,
  )
  if (DRY_RUN) {
    console.log("    ──── DRY-RUN SUMMARY ────")
    console.log(aiSummary.split("\n").map((l) => "    " + l).join("\n"))
    console.log("    ──── END SUMMARY ────")
  }
  return { ok: true, latencyMs, summary: aiSummary }
}

async function main() {
  console.log(`backfill-tommy-weekly-summaries — force=${FORCE} dry_run=${DRY_RUN}`)

  const today = new Date().toISOString().slice(0, 10)
  const { data: weeks, error: weeksErr } = await supabase
    .from("tommy_award_weeks")
    .select("id, week_date, week_name")
    .gte("week_date", "2026-01-01")
    .lte("week_date", today)
    .order("week_date", { ascending: true })
  if (weeksErr) throw weeksErr

  const weekIds = weeks.map((w) => w.id)

  const { data: existingRecaps } = await supabase
    .from("tommy_weekly_recaps")
    .select("week_id, ai_summary")
    .in("week_id", weekIds)

  const existingMap = new Map((existingRecaps ?? []).map((r) => [r.week_id, r]))

  const { data: allBallots } = await supabase
    .from("tommy_award_ballots")
    .select("*")
    .in("week_id", weekIds)

  console.log(
    `Surveying ${weeks.length} weeks (Jan 1 → ${today}). ${existingMap.size} already have recap rows; ${allBallots?.length ?? 0} ballots total.\n`,
  )

  let processed = 0
  for (const week of weeks) {
    if (LIMIT !== null && processed >= LIMIT) {
      console.log(`\nReached --limit=${LIMIT}, stopping.`)
      break
    }
    const existing = existingMap.get(week.id)
    if (existing?.ai_summary && !FORCE) {
      console.log(`  · ${week.week_date} — already summarised, skipping (use --force to overwrite)`)
      continue
    }
    try {
      const result = await summariseWeek(week, allBallots ?? [])
      if (result?.ok) processed++
    } catch (err) {
      console.error(`  ✗ ${week.week_date} — failed:`, err.message ?? err)
    }
  }

  console.log("\nDone.")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
