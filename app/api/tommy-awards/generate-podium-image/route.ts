// Async podium-image generator
// ─────────────────────────────
// gpt-image-2 `quality:high` + the vision-grounded prompt-drafting step
// (multimodal hero-profile image fetches → GPT-5.5-pro → image render →
// Vercel Blob upload) routinely runs 3–5 minutes end to end. That's well
// past the Friday recap cron's email-critical path, so we split image
// generation into its own function invocation with the full Fluid Compute
// 800s ceiling.
//
// The Friday recap cron does everything else (AI prose, PDF, email)
// inside its own ~10s budget, ships the email immediately, and then
// fire-and-forgets a POST to this route. This route renders the image,
// uploads it to Blob, and updates `tommy_weekly_recaps.podium_image_url`
// so the Weekly Tommy's tab + future links pick it up.
//
// The image quality and the locked-in vision-grounded grounding rule
// (HeroProfile.imageUrl → multimodal input → gpt-image-2) are unchanged
// — see the user `tommy-image-generation` memory file.

import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { generatePodiumImage } from "@/lib/tommy-awards/generate-podium-image"

export const runtime = "nodejs"
// Fluid Compute (Pro) supports up to 800s — give the image step a
// comfortable ceiling so a slow gpt-image-2 render never silently fails.
export const maxDuration = 800

interface RequestBody {
  weekId: string
}

export async function POST(req: NextRequest) {
  // Auth: same secret as the recap cron so only our server can trigger it.
  const auth = req.headers.get("authorization") ?? ""
  const expected = `Bearer ${process.env.CRON_SECRET}`
  if (auth !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  let body: RequestBody
  try {
    body = (await req.json()) as RequestBody
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 })
  }

  const weekId = body.weekId
  if (!weekId) {
    return NextResponse.json({ error: "missing_weekId" }, { status: 400 })
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // Pull the recap + the top-three so we know who to render.
  const { data: recap, error: recapErr } = await supabase
    .from("tommy_weekly_recaps")
    .select("week_id, week_label, top_three, podium_image_url")
    .eq("week_id", weekId)
    .maybeSingle()

  if (recapErr || !recap) {
    console.error("[v0] tommy-image-async: recap lookup failed", recapErr, weekId)
    return NextResponse.json({ error: "recap_not_found", weekId }, { status: 404 })
  }

  if (recap.podium_image_url) {
    // Idempotent — if an image is already attached, don't re-render.
    return NextResponse.json({ ok: true, alreadyHasImage: true, url: recap.podium_image_url })
  }

  const topThree = (recap.top_three ?? []) as Array<{ name: string; rank: number }>
  if (topThree.length === 0) {
    return NextResponse.json({ ok: true, skipped: "empty_podium" })
  }

  // Look up hero_profile_slug for each winner so the prompt can ground
  // on canonical Alliance design language. P24 is the joint Ganesh +
  // Thameem alias — hard-coded because team_members stores individuals.
  const { data: heroSlugRows } = await supabase
    .from("team_members")
    .select("full_name, hero_profile_slug")
    .in(
      "full_name",
      topThree.filter((t) => t.name !== "P24").map((t) => t.name),
    )

  const heroSlugByName = new Map(
    (heroSlugRows ?? []).map((r) => [r.full_name, r.hero_profile_slug as string | null]),
  )

  console.log("[v0] tommy-image-async: rendering image for week", weekId)
  const started = Date.now()

  const result = await generatePodiumImage({
    weekLabel: recap.week_label as string,
    winners: topThree.map((t) => ({
      name: t.name,
      rank: t.rank,
      heroSlug:
        t.name === "P24"
          ? "p24-shadow-task-force"
          : heroSlugByName.get(t.name) ?? null,
    })),
  })

  const elapsedMs = Date.now() - started
  console.log("[v0] tommy-image-async: image step completed in", elapsedMs, "ms")

  if (!result) {
    return NextResponse.json({ error: "image_generation_failed", elapsedMs }, { status: 500 })
  }

  // Persist on the recap row so the Weekly Tommy's tab picks it up.
  const { error: updateErr } = await supabase
    .from("tommy_weekly_recaps")
    .update({
      podium_image_url: result.imageUrl,
      podium_image_prompt: result.promptUsed,
      podium_image_model: result.imageModel,
    })
    .eq("week_id", weekId)

  if (updateErr) {
    console.error("[v0] tommy-image-async: update failed", updateErr)
    return NextResponse.json(
      { error: "update_failed", url: result.imageUrl, message: updateErr.message },
      { status: 500 },
    )
  }

  return NextResponse.json({
    ok: true,
    weekId,
    imageUrl: result.imageUrl,
    elapsedMs,
  })
}
