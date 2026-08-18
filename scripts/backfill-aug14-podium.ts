/**
 * One-off backfill: regenerate the podium image + PDF for the Aug 14,
 * 2026 Tommy Awards recap now that `tommy_weekly_recaps.top_three` has
 * been corrected (via the PREPARE cron re-run) to the real winners —
 * Dat Le, Amy Sparaco, Shinika Shelley.
 *
 * Mirrors app/api/tommy-awards/recap/regenerate-image/route.ts exactly,
 * but runs directly in-process (via tsx) against the shared production
 * Supabase + Blob store so it isn't bound by an HTTP function timeout —
 * the vision-grounded prompt draft + gpt-image-2 high-quality render
 * routinely takes 2-5 minutes.
 *
 * Run once, then delete. Not part of the deployed app.
 */
import { createClient } from "@supabase/supabase-js"
import { generatePodiumImage } from "../lib/tommy-awards/generate-podium-image"
import { generatePodiumPdf, type PodiumPdfWinner } from "../lib/tommy-awards/generate-podium-pdf"

const WEEK_ID = "9498edc7-7d15-4853-b3f5-7ee4caa3f9fb" // Friday, August 14, 2026

async function main() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: recap, error: recapErr } = await supabase
    .from("tommy_weekly_recaps")
    .select("week_id, week_label, ai_summary, total_ballots, top_three")
    .eq("week_id", WEEK_ID)
    .maybeSingle()

  if (recapErr) throw recapErr
  if (!recap) throw new Error("recap not found")

  const topThree = (recap.top_three as Array<PodiumPdfWinner & { name: string; rank: number }>) ?? []
  console.log("[backfill] top_three:", topThree.map((t) => `${t.rank}. ${t.name}`).join(", "))
  if (topThree.length === 0) throw new Error("recap has no top_three")

  const namesForLookup = topThree.map((t) => t.name).filter((n) => n && n !== "P24")
  const { data: heroSlugRows } = await supabase
    .from("team_members")
    .select("full_name, hero_profile_slug")
    .in("full_name", namesForLookup)
  const heroSlugByName = new Map(
    (heroSlugRows ?? []).map((r) => [r.full_name, r.hero_profile_slug as string | null]),
  )

  console.log("[backfill] generating podium image…")
  const result = await generatePodiumImage({
    weekLabel: recap.week_label as string,
    winners: topThree.map((t) => ({
      name: t.name,
      rank: t.rank,
      heroSlug: t.name === "P24" ? "p24-shadow-task-force" : heroSlugByName.get(t.name) ?? null,
    })),
  })

  if (!result) throw new Error("image generation failed")
  console.log("[backfill] image generated:", result.imageUrl)

  const { error: updErr } = await supabase
    .from("tommy_weekly_recaps")
    .update({
      podium_image_url: result.imageUrl,
      podium_image_prompt: result.promptUsed,
      podium_image_model: result.imageModel,
    })
    .eq("week_id", WEEK_ID)
  if (updErr) throw updErr

  console.log("[backfill] generating PDF…")
  const pdfResult = await generatePodiumPdf({
    weekId: WEEK_ID,
    weekLabel: recap.week_label as string,
    aiSummary: (recap.ai_summary as string) ?? "",
    topThree,
    totalBallots: (recap.total_ballots as number) ?? 0,
    podiumImageUrl: result.imageUrl,
  })

  if (!pdfResult) throw new Error("pdf generation failed")
  console.log("[backfill] pdf generated:", pdfResult.pdfUrl)

  const { error: pdfUpdErr } = await supabase
    .from("tommy_weekly_recaps")
    .update({ podium_pdf_url: pdfResult.pdfUrl })
    .eq("week_id", WEEK_ID)
  if (pdfUpdErr) throw pdfUpdErr

  console.log("[backfill] done.")
}

main().catch((err) => {
  console.error("[backfill] failed:", err)
  process.exit(1)
})
