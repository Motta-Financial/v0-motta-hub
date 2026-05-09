/**
 * POST /api/jotform/webhook?token=<webhook_secret>
 *
 * Webhook receiver for new Jotform submissions. Jotform sends the
 * payload as `multipart/form-data` with these fields:
 *   - submissionID, formID, formTitle, ip, username
 *   - rawRequest (a JSON-encoded string of all answers, keyed by qid_name)
 *   - pretty (human-readable summary)
 *   - "{question name}" (per-field flat copies)
 *
 * To get the structured `answers` map we re-fetch the submission via
 * the Jotform API. This costs one API call per webhook (~50/day max)
 * but gives us the same shape the backfill uses, so parsing is shared.
 *
 * Auth: per-form `webhook_secret` token in the query string. Jotform's
 * free tier doesn't sign payloads, so the secret URL is the standard
 * pattern. Tokens are random 24-byte hex generated when the form row
 * is seeded; rotate by updating `jotform_forms.webhook_secret` and
 * re-registering the webhook URL.
 */
import { NextResponse } from "next/server"
import { getSubmission } from "@/lib/jotform/client"
import { submissionFromWebhookPayload } from "@/lib/jotform/parse"
import {
  recordWebhookEvent,
  upsertIntakeSubmission,
  upsertFeedbackSubmission,
  getFormByWebhookToken,
  markWebhookProcessed,
  markWebhookFailed,
} from "@/lib/jotform/ingest"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

async function readPayload(req: Request): Promise<{
  formID: string | null
  submissionID: string | null
  raw: Record<string, unknown>
}> {
  const ct = req.headers.get("content-type") ?? ""
  const raw: Record<string, unknown> = {}

  if (ct.includes("multipart/form-data") || ct.includes("application/x-www-form-urlencoded")) {
    const fd = await req.formData()
    for (const [k, v] of fd.entries()) {
      // Files come through as File objects — record metadata only.
      if (typeof v === "string") raw[k] = v
      else raw[k] = { filename: v.name, size: v.size, type: v.type }
    }
  } else if (ct.includes("application/json")) {
    Object.assign(raw, await req.json())
  } else {
    raw.body = await req.text()
  }

  return {
    formID: typeof raw.formID === "string" ? raw.formID : null,
    submissionID: typeof raw.submissionID === "string" ? raw.submissionID : null,
    raw,
  }
}

export async function POST(req: Request) {
  const url = new URL(req.url)
  const token = url.searchParams.get("token")

  // Read body first (multipart streams can only be read once),
  // so even an unauthorized hit still tells us what was attempted.
  const payload = await readPayload(req).catch((err) => {
    console.log("[v0] jotform webhook body read failed:", err)
    return null
  })

  if (!payload) {
    return NextResponse.json({ ok: false, error: "Could not parse body" }, { status: 400 })
  }

  // Authenticate against the per-form secret.
  if (!token) {
    return NextResponse.json({ ok: false, error: "Missing token" }, { status: 401 })
  }

  // Single point of authentication + form-kind lookup. The token is
  // unique per form, so this is also how we route between the intake
  // and feedback target tables without baking IDs into route paths.
  const formRow = await getFormByWebhookToken(token)
  if (!formRow) {
    console.log("[v0] jotform webhook bad token")
    return NextResponse.json({ ok: false, error: "Invalid token" }, { status: 401 })
  }

  if (payload.formID && payload.formID !== formRow.jotform_form_id) {
    return NextResponse.json(
      { ok: false, error: "Token / form mismatch" },
      { status: 401 },
    )
  }

  // Persist the raw event before any parsing — so a parser bug
  // never costs us the submission.
  const headers: Record<string, string> = {}
  req.headers.forEach((v, k) => {
    if (k.toLowerCase() === "cookie" || k.toLowerCase() === "authorization") return
    headers[k] = v
  })
  const sourceIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null

  let eventId: string | null = null
  try {
    eventId = await recordWebhookEvent({
      jotform_form_id: payload.formID,
      jotform_submission_id: payload.submissionID,
      raw_payload: payload.raw,
      request_headers: headers,
      source_ip: sourceIp,
    })
  } catch (err) {
    console.log("[v0] jotform webhook recordEvent error:", (err as Error).message)
  }

  if (!payload.submissionID) {
    if (eventId) await markWebhookFailed(eventId, "Missing submissionID in payload")
    return NextResponse.json({ ok: false, error: "Missing submissionID" }, { status: 400 })
  }

  // Primary ingest path — trust the multipart `rawRequest` Jotform
  // already handed us. This makes the webhook independent of Jotform's
  // API uptime: if the API goes down, we still capture every
  // submission. We only fall back to fetching from the API when
  // `rawRequest` is missing or unparseable (e.g. malformed payload, or
  // a webhook resend after we've changed the form schema).
  try {
    let rawRequest: unknown = null
    const r = payload.raw.rawRequest
    if (typeof r === "string") {
      try {
        rawRequest = JSON.parse(r)
      } catch {
        rawRequest = null
      }
    } else if (r && typeof r === "object") {
      rawRequest = r
    }

    let submission
    if (rawRequest && typeof rawRequest === "object" && Object.keys(rawRequest as object).length > 0) {
      submission = submissionFromWebhookPayload({
        formId: payload.formID ?? formRow.jotform_form_id,
        submissionId: payload.submissionID,
        rawRequest,
        ip: typeof payload.raw.ip === "string" ? (payload.raw.ip as string) : sourceIp,
      })
      // Drop test/synthetic submissions when the ID isn't numeric so
      // they don't pollute production data alongside real entries.
      // Real Jotform submission IDs are 19-digit strings.
      if (!/^\d{10,}$/.test(payload.submissionID)) {
        if (eventId) await markWebhookProcessed(eventId)
        return NextResponse.json({
          ok: true,
          test: true,
          message: "Synthetic submission accepted but not persisted (non-numeric ID)",
        })
      }
    } else {
      // Fallback — pull canonical answers from the Jotform API. Costs
      // one API call but shouldn't happen for normal deliveries.
      console.log("[v0] jotform webhook missing rawRequest, falling back to API fetch")
      submission = await getSubmission(payload.submissionID)
    }

    // Dispatch by form `kind`. Each kind has a denormalized target
    // table shaped to that form's actual fields; an unknown kind
    // still gets the raw payload preserved on `jotform_webhook_events`
    // (recorded above) but we don't pretend to denormalize it.
    switch (formRow.kind) {
      case "intake":
        await upsertIntakeSubmission(submission)
        break
      case "feedback":
        await upsertFeedbackSubmission(submission)
        break
      default:
        // Audit-only — log so we notice any 'debrief' / 'other'
        // forms that get registered without a corresponding
        // ingest path implemented.
        console.log("[v0] jotform webhook: kind without ingest path:", formRow.kind, "form:", formRow.jotform_form_id)
    }
    if (eventId) await markWebhookProcessed(eventId)
    return NextResponse.json({ ok: true, submission_id: submission.id, kind: formRow.kind })
  } catch (err) {
    const msg = (err as Error).message
    console.log("[v0] jotform webhook ingest error:", msg)
    if (eventId) await markWebhookFailed(eventId, msg)
    // Return 200 so Jotform doesn't retry forever — the audit log row
    // shows `failed` and we replay manually if needed.
    return NextResponse.json({ ok: false, error: msg }, { status: 200 })
  }
}

// Some Jotform health checks send GET — answer cheaply.
export async function GET() {
  return NextResponse.json({ ok: true, message: "Jotform webhook endpoint ready" })
}
