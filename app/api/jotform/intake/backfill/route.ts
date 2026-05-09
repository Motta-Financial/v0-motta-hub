/**
 * POST /api/jotform/intake/backfill
 *
 * Pulls every submission for the intake form via the Jotform API and
 * upserts them into `jotform_intake_submissions`. Safe to re-run — the
 * upsert dedupes on `jotform_submission_id`.
 *
 * Body (optional JSON):
 *   { formId?: string, limit?: number }
 */
import { NextResponse } from "next/server"
import { iterateAllSubmissions } from "@/lib/jotform/client"
import { upsertIntakeSubmission } from "@/lib/jotform/ingest"

const DEFAULT_FORM_ID = "242306172162144"

export const dynamic = "force-dynamic"
export const maxDuration = 300 // up to 5 min for large backfills
export const runtime = "nodejs"

export async function POST(req: Request) {
  let body: { formId?: string; limit?: number } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    /* empty body OK */
  }
  const formId = body.formId ?? DEFAULT_FORM_ID
  const cap = body.limit ?? Number.POSITIVE_INFINITY

  let processed = 0
  const failures: Array<{ id: string; error: string }> = []
  const startedAt = Date.now()

  for await (const submission of iterateAllSubmissions(formId, 100)) {
    if (processed >= cap) break
    try {
      await upsertIntakeSubmission(submission)
      processed += 1
    } catch (err) {
      failures.push({ id: submission.id, error: (err as Error).message })
    }
  }

  return NextResponse.json({
    ok: true,
    form_id: formId,
    processed,
    failed: failures.length,
    failures,
    duration_ms: Date.now() - startedAt,
  })
}
