import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/auth/require-admin"
import { generatePodiumImage } from "@/lib/tommy-awards/generate-podium-image"
import { generatePodiumPdf, type PodiumPdfWinner } from "@/lib/tommy-awards/generate-podium-pdf"

/**
 * Backfill / re-generate the F1-podium image (and, optionally, the
 * matching PDF) for an already-persisted Tommy Awards weekly recap.
 *
 * Why this exists separate from the Friday cron:
 *   - The Friday recap cron sends emails AND generates the image in one
 *     shot. If the image step silently fails, drifts (e.g. rendering
 *     extra teammates who aren't actually winners, or splitting a tie
 *     across separate podium tiers), or a recap was sent before the
 *     image pipeline existed, the row ends up with a wrong or missing
 *     `podium_image_url`.
 *   - This endpoint lets us (a) backfill historical recaps, (b)
 *     hand-retry a failed/incorrect image generation, and (c) supply a
 *     hand-edited CUSTOM prompt when the auto-drafted one produced a
 *     bad render — all WITHOUT re-emailing the firm.
 *
 * Two supported callers:
 *   1. Cron / scripts — `Authorization: Bearer ${CRON_SECRET}`. Used
 *      for automated backfills and retries.
 *   2. Signed-in admins — the Motta Alliance "Regenerate" dialog calls
 *      this with the caller's session cookie. Gated by `requireAdmin()`
 *      (team_members.role in Company/Partner/Admin), same tier as the
 *      other admin-only tooling in this app.
 *
 * Resolution:
 *   - `week_id` (query param OR JSON body) regenerates that specific
 *     recap.
 *   - no `week_id` → regenerates the most recent recap row with a
 *     non-empty top_three. (cron/script convenience only — the admin UI
 *     always passes an explicit week_id.)
 *
 * Body (JSON, optional):
 *   - `week_id`: string — same as the query param, alternate transport.
 *   - `customPrompt`: string — when provided, bypasses the GPT-5.5-pro
 *     vision-drafting step entirely and renders this prompt verbatim.
 *   - `regeneratePdf`: boolean (default true) — also rebuild the
 *     dispatch PDF with the new image so the "Read"/"Download" buttons
 *     in the Weekly Tommy's archive reflect the fix immediately.
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization")
  const cronAuthorized = authHeader === `Bearer ${process.env.CRON_SECRET}`

  let callerLabel = "cron"
  if (!cronAuthorized) {
    const admin = await requireAdmin()
    if (!admin.ok) return admin.response
    callerLabel = admin.email ?? admin.userId
  }

  const url = new URL(request.url)
  let weekId = url.searchParams.get("week_id")
  let customPrompt: string | null = null
  let regeneratePdf = true

  // Body is optional — cron callers may still hit this with just the
  // query param and no body, so we don't require valid JSON.
  try {
    const body = await request.json()
    if (body && typeof body === "object") {
      if (typeof body.week_id === "string" && body.week_id) weekId = body.week_id
      if (typeof body.customPrompt === "string" && body.customPrompt.trim()) {
        customPrompt = body.customPrompt.trim()
      }
      if (typeof body.regeneratePdf === "boolean") regeneratePdf = body.regeneratePdf
    }
  } catch {
    // no/invalid JSON body — fall back to query param + defaults above.
  }

  try {
    const supabase = createAdminClient()

    // Load the target recap row. Either the one explicitly requested or
    // the most recent persisted recap.
    const recapQuery = supabase
      .from("tommy_weekly_recaps")
      .select(
        "week_id, week_label, ai_summary, total_ballots, top_three, podium_image_url, podium_image_prompt, podium_image_model",
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

    const topThree = (recap.top_three as Array<PodiumPdfWinner & { name: string; rank: number }> | null) ?? []
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

    console.log(
      `[v0] regenerate-image: caller=${callerLabel} week_id=${recap.week_id} customPrompt=${customPrompt ? "yes" : "no"}`,
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
      customPrompt,
    })

    if (!result) {
      return NextResponse.json(
        { error: "Image generation failed — check logs for upstream error." },
        { status: 502 },
      )
    }

    // Persist the new image URL + prompt + model so the dashboard picks
    // it up on the next read. We intentionally do NOT touch email_sent_*
    // columns here since this endpoint never re-sends the recap email.
    const { error: updErr } = await supabase
      .from("tommy_weekly_recaps")
      .update({
        podium_image_url: result.imageUrl,
        podium_image_prompt: result.promptUsed,
        podium_image_model: result.imageModel,
      })
      .eq("week_id", recap.week_id)

    if (updErr) throw updErr

    // ── Optionally rebuild the dispatch PDF so it embeds the fixed
    //    image immediately, rather than leaving it stale until the
    //    next scheduled PDF run. Mirrors app/api/cron/tommy-recap-pdf.
    let podiumPdfUrl: string | null = null
    let pdfError: string | null = null
    if (regeneratePdf) {
      const pdfResult = await generatePodiumPdf({
        weekId: recap.week_id,
        weekLabel: recap.week_label,
        aiSummary: (recap.ai_summary as string) ?? "",
        topThree,
        totalBallots: (recap.total_ballots as number) ?? 0,
        podiumImageUrl: result.imageUrl,
      })
      if (pdfResult) {
        podiumPdfUrl = pdfResult.pdfUrl
        const { error: pdfUpdErr } = await supabase
          .from("tommy_weekly_recaps")
          .update({ podium_pdf_url: pdfResult.pdfUrl })
          .eq("week_id", recap.week_id)
        if (pdfUpdErr) throw pdfUpdErr
      } else {
        pdfError = "PDF regeneration failed — image was updated but the dispatch PDF still reflects the old art."
        console.error("[v0] regenerate-image: PDF rebuild failed for week", recap.week_id)
      }
    }

    return NextResponse.json({
      success: true,
      week_id: recap.week_id,
      week_label: recap.week_label,
      podium_image_url: result.imageUrl,
      podium_image_prompt: result.promptUsed,
      podium_image_model: result.imageModel,
      podium_pdf_url: podiumPdfUrl,
      pdf_error: pdfError,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[v0] regenerate-image error:", message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
