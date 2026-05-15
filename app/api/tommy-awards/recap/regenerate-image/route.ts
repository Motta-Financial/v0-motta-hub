import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { generatePodiumImage } from "@/lib/tommy-awards/generate-podium-image"

/**
 * Backfill / re-generate the F1-podium image for an already-persisted
 * Tommy Awards weekly recap.
 *
 * Why this exists separate from the Friday cron:
 *   - The Friday recap cron sends emails AND generates the image in one
 *     shot. If the image step silently fails (or if a recap was sent
 *     before the image pipeline existed), the row ends up with
 *     `podium_image_url = null` and the Weekly Leaderboard panel has
 *     nothing to render.
 *   - This endpoint lets us (a) backfill historical recaps and
 *     (b) hand-retry a failed image generation WITHOUT re-emailing
 *     the firm.
 *
 * Resolution:
 *   - `?week_id=<uuid>` regenerates that specific recap.
 *   - no params → regenerates the most recent recap row with a
 *     non-empty top_three.
 *
 * Auth: same Bearer ${CRON_SECRET} contract the cron routes use, so
 * scripts and the cron retry job can call it without a separate token.
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.CRON_SECRET && process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  const url = new URL(request.url)
  const weekId = url.searchParams.get("week_id")

  try {
    const supabase = createAdminClient()

    // Load the target recap row. Either the one explicitly requested or
    // the most recent persisted recap.
    const recapQuery = supabase
      .from("tommy_weekly_recaps")
      .select(
        "week_id, week_label, top_three, podium_image_url, podium_image_prompt, podium_image_model",
      )
    const { data: recap, error: recapErr } = weekId
      ? await recapQuery.eq("week_id", weekId).maybeSingle()
      : await recapQuery.order("week_date", { ascending: false }).limit(1).maybeSingle()

    if (recapErr) throw recapErr
    if (!recap) {
      return NextResponse.json(
        { error: "Recap not found", week_id: weekId },
        { status: 404 },
      )
    }

    const topThree = (recap.top_three as Array<{ name: string; rank: number }> | null) ?? []
    if (topThree.length === 0) {
      return NextResponse.json(
        { error: "Recap has no top_three data — nothing to render." },
        { status: 422 },
      )
    }

    // Mirror the cron's hero-slug lookup so the regenerated image uses
    // the exact same Alliance art direction the Friday send would have.
    const namesForLookup = topThree
      .map((t) => t.name)
      .filter((n) => n && n !== "P24")
    const { data: heroSlugRows } = await supabase
      .from("team_members")
      .select("full_name, hero_profile_slug")
      .in("full_name", namesForLookup)
    const heroSlugByName = new Map(
      (heroSlugRows ?? []).map((r) => [r.full_name, r.hero_profile_slug as string | null]),
    )

    const result = await generatePodiumImage({
      weekLabel: recap.week_label,
      winners: topThree.map((t) => ({
        name: t.name,
        rank: t.rank,
        heroSlug:
          t.name === "P24"
            ? "p24-shadow-task-force"
            : heroSlugByName.get(t.name) ?? null,
      })),
    })

    if (!result) {
      return NextResponse.json(
        { error: "Image generation failed — check logs for upstream error." },
        { status: 502 },
      )
    }

    // Persist the new image URL + prompt + model so the dashboard picks
    // it up on the next read. We intentionally do NOT touch email_sent_*
    // columns here since this endpoint is image-only.
    const { error: updErr } = await supabase
      .from("tommy_weekly_recaps")
      .update({
        podium_image_url: result.imageUrl,
        podium_image_prompt: result.promptUsed,
        podium_image_model: result.imageModel,
      })
      .eq("week_id", recap.week_id)

    if (updErr) throw updErr

    return NextResponse.json({
      success: true,
      week_id: recap.week_id,
      week_label: recap.week_label,
      podium_image_url: result.imageUrl,
      podium_image_model: result.imageModel,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[v0] regenerate-image error:", message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
