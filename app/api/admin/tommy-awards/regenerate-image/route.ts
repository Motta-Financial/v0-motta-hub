import { type NextRequest, NextResponse } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { generatePodiumImage } from "@/lib/tommy-awards/generate-podium-image"

/**
 * Admin proxy for triggering a podium image regeneration from the UI.
 *
 * Calls generatePodiumImage directly (no internal HTTP hop) so it works in
 * production without needing the CRON_SECRET in the browser.
 *
 * Auth: requires a valid Supabase session (any logged-in team member).
 *
 * Usage: POST /api/admin/tommy-awards/regenerate-image?week_id=<uuid>
 */
export async function POST(request: NextRequest) {
  // Verify caller has a valid session
  const supabase = await createClient()
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser()

  if (authErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(request.url)
  const weekId = url.searchParams.get("week_id")
  if (!weekId) {
    return NextResponse.json({ error: "week_id is required" }, { status: 400 })
  }

  try {
    const adminSupabase = createAdminClient()

    // Load the recap row
    const { data: recap, error: recapErr } = await adminSupabase
      .from("tommy_weekly_recaps")
      .select("week_id, week_label, top_three")
      .eq("week_id", weekId)
      .maybeSingle()

    if (recapErr) throw recapErr
    if (!recap) {
      return NextResponse.json({ error: "Recap not found" }, { status: 404 })
    }

    const topThree = (recap.top_three as Array<{ name: string; rank: number }> | null) ?? []
    if (topThree.length === 0) {
      return NextResponse.json(
        { error: "Recap has no top_three data — nothing to render." },
        { status: 422 },
      )
    }

    // Look up hero slugs for the top_three names
    const namesForLookup = topThree.map((t) => t.name).filter((n) => n && n !== "P24")
    const { data: heroSlugRows } = await adminSupabase
      .from("team_members")
      .select("full_name, hero_profile_slug")
      .in("full_name", namesForLookup)

    const heroSlugByName = new Map(
      (heroSlugRows ?? []).map((r) => [r.full_name, r.hero_profile_slug as string | null]),
    )

    // Generate the image directly — no internal HTTP hop
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
        { error: "Image generation failed — check server logs." },
        { status: 502 },
      )
    }

    // Persist the new image URL
    const { error: updErr } = await adminSupabase
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
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[tommy-awards] admin regenerate-image error:", message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
