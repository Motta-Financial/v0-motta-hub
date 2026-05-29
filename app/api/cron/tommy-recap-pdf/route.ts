// ── STAGE 3 of 4: PDF ─────────────────────────────────────────────────
// Builds the printable / shareable Tommy recap PDF with the freshly
// rendered podium image embedded, then persists the public Blob URL on
// `tommy_weekly_recaps.podium_pdf_url`.
//
// This is the END of the prep chain. It is triggered (fire-and-forget)
// by the image stage once the podium art is ready, so by the time the
// noon SEND cron runs, both the image and the matching PDF are on the
// recap row. The send stage attaches this PDF to the email.
//
// Why a separate invocation: the image stage runs on an 800s budget and
// we don't want to risk the PDF render (which fetches the image over
// HTTP + lays out the document) eating into that. A clean hand-off keeps
// each step independently observable and retryable.

import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { generatePodiumPdf, type PodiumPdfWinner } from "@/lib/tommy-awards/generate-podium-pdf"

export const runtime = "nodejs"
export const maxDuration = 120

interface RequestBody {
  weekId: string
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? ""
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
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

  const { data: recap, error: recapErr } = await supabase
    .from("tommy_weekly_recaps")
    .select("week_id, week_label, ai_summary, top_three, total_ballots, podium_image_url")
    .eq("week_id", weekId)
    .maybeSingle()

  if (recapErr || !recap) {
    console.error("[v0] tommy-recap-pdf: recap lookup failed", recapErr, weekId)
    return NextResponse.json({ error: "recap_not_found", weekId }, { status: 404 })
  }

  const topThree = (recap.top_three ?? []) as PodiumPdfWinner[]
  if (topThree.length === 0) {
    return NextResponse.json({ ok: true, skipped: "empty_podium" })
  }

  console.log("[v0] tommy-recap-pdf: building PDF for week", weekId)

  const pdfResult = await generatePodiumPdf({
    weekId,
    weekLabel: recap.week_label as string,
    aiSummary: (recap.ai_summary as string) ?? "",
    topThree,
    totalBallots: (recap.total_ballots as number) ?? 0,
    podiumImageUrl: (recap.podium_image_url as string | null) ?? null,
  })

  if (!pdfResult) {
    return NextResponse.json({ error: "pdf_generation_failed" }, { status: 500 })
  }

  const { error: updateErr } = await supabase
    .from("tommy_weekly_recaps")
    .update({ podium_pdf_url: pdfResult.pdfUrl })
    .eq("week_id", weekId)

  if (updateErr) {
    console.error("[v0] tommy-recap-pdf: update failed", updateErr)
    return NextResponse.json(
      { error: "update_failed", url: pdfResult.pdfUrl, message: updateErr.message },
      { status: 500 },
    )
  }

  return NextResponse.json({
    ok: true,
    weekId,
    pdfUrl: pdfResult.pdfUrl,
    hadImage: Boolean(recap.podium_image_url),
  })
}
