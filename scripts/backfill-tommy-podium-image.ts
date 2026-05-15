/**
 * One-shot backfill for Tommy Awards recap rows that have no
 * `podium_image_url`. Runs the same generatePodiumImage pipeline the
 * Friday cron uses, then persists the result. Image-only — does not
 * touch email columns or re-send any emails.
 *
 * Usage:
 *   pnpm exec tsx scripts/backfill-tommy-podium-image.ts
 *
 * Targets every recap row with a null image and a non-empty top_three.
 * Run multiple times safely — already-backfilled rows are skipped.
 */
import { createClient } from "@supabase/supabase-js"
import { generatePodiumImage } from "../lib/tommy-awards/generate-podium-image"

async function main() {
  const s = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: recaps, error } = await s
    .from("tommy_weekly_recaps")
    .select("week_id, week_label, top_three")
    .is("podium_image_url", null)
    .order("week_date", { ascending: false })

  if (error) throw error
  if (!recaps || recaps.length === 0) {
    console.log("[v0] no recaps missing podium_image_url")
    return
  }

  console.log(`[v0] backfilling ${recaps.length} recap(s)`)

  for (const recap of recaps) {
    const topThree = (recap.top_three as Array<{ name: string; rank: number }> | null) ?? []
    if (topThree.length === 0) {
      console.log(`[v0] skipping ${recap.week_label} (no top_three)`)
      continue
    }

    const names = topThree.map((t) => t.name).filter((n) => n && n !== "P24")
    const { data: rows } = await s
      .from("team_members")
      .select("full_name, hero_profile_slug")
      .in("full_name", names)
    const slugBy = new Map(
      (rows ?? []).map((r) => [r.full_name, r.hero_profile_slug as string | null]),
    )

    console.log(`[v0] generating image for ${recap.week_label}…`)
    const result = await generatePodiumImage({
      weekLabel: recap.week_label,
      winners: topThree.map((t) => ({
        name: t.name,
        rank: t.rank,
        heroSlug:
          t.name === "P24"
            ? "p24-shadow-task-force"
            : slugBy.get(t.name) ?? null,
      })),
    })

    if (!result) {
      console.error(`[v0] generation returned null for ${recap.week_label}`)
      continue
    }

    const { error: updErr } = await s
      .from("tommy_weekly_recaps")
      .update({
        podium_image_url: result.imageUrl,
        podium_image_prompt: result.promptUsed,
        podium_image_model: result.imageModel,
      })
      .eq("week_id", recap.week_id)

    if (updErr) {
      console.error(`[v0] persist failed for ${recap.week_label}:`, updErr)
      continue
    }

    console.log(`[v0] ${recap.week_label} → ${result.imageUrl}`)
  }
}

main().catch((err) => {
  console.error("[v0] backfill failed:", err)
  process.exit(1)
})
