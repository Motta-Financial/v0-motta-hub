import { type NextRequest, NextResponse } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { generatePodiumImage } from "@/lib/tommy-awards/generate-podium-image"
import { after } from "next/server"

/**
 * Admin proxy for triggering a podium image regeneration from the UI.
 *
 * Returns 202 immediately and runs the heavy AI work in the background
 * via next/server `after()`, so the response fires well within the 60s
 * serverless timeout. The client polls
 * GET /api/admin/tommy-awards/regenerate-image?week_id=<uuid>
 * until podium_image_url is non-null in the DB.
 *
 * Auth: requires a valid Supabase session (any logged-in team member).
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

  const adminSupabase = createAdminClient()

  // Load the recap row eagerly so we can validate before accepting
  const { data: recap, error: recapErr } = await adminSupabase
    .from("tommy_weekly_recaps")
    .select("week_id, week_label, top_three")
    .eq("week_id", weekId)
    .maybeSingle()

  if (recapErr) {
    return NextResponse.json({ error: recapErr.message }, { status: 500 })
  }
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

  // Clear the old image URL so the client can detect "in progress"
  await adminSupabase
    .from("tommy_weekly_recaps")
    .update({ podium_image_url: null, podium_image_prompt: null, podium_image_model: null })
    .eq("week_id", weekId)

  // ── Fire-and-forget the heavy AI work ────────────────────────────
  // `after()` runs AFTER the response is sent, keeping it alive on
  // Vercel's infrastructure without blocking the HTTP response.
  after(async () => {
    try {
      const namesForLookup = topThree.map((t) => t.name).filter((n) => n && n !== "P24")
      const { data: heroSlugRows } = await adminSupabase
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

      if (result) {
        await adminSupabase
          .from("tommy_weekly_recaps")
          .update({
            podium_image_url: result.imageUrl,
            podium_image_prompt: result.promptUsed,
            podium_image_model: result.imageModel,
          })
          .eq("week_id", weekId)
        console.log(`[tommy-awards] admin regenerate-image: done — ${result.imageUrl}`)
      } else {
        console.error("[tommy-awards] admin regenerate-image: generatePodiumImage returned null")
      }
    } catch (err) {
      console.error("[tommy-awards] admin regenerate-image background error:", err)
    }
  })

  // Respond immediately — client will poll for the result
  return NextResponse.json(
    { accepted: true, week_id: weekId, message: "Image generation started — polling for result…" },
    { status: 202 },
  )
}

/**
 * Poll endpoint — returns the current podium_image_url for a week.
 * The client calls this every 5 s until image_url is non-null.
 */
export async function GET(request: NextRequest) {
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

  const adminSupabase = createAdminClient()
  const { data, error } = await adminSupabase
    .from("tommy_weekly_recaps")
    .select("week_id, podium_image_url")
    .eq("week_id", weekId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    week_id: weekId,
    podium_image_url: data?.podium_image_url ?? null,
    ready: !!data?.podium_image_url,
  })
}
