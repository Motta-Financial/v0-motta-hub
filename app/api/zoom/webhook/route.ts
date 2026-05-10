/**
 * Zoom webhook receiver.
 *
 * Handles every event delivered by a Zoom Marketplace app's
 * "Feature > Event Subscriptions" config. Three responsibilities,
 * in this order:
 *
 *   1. Verify HMAC signature (`x-zm-signature` + `x-zm-request-timestamp`)
 *      against `ZOOM_WEBHOOK_SECRET_TOKEN`. Bad signatures are logged
 *      to `zoom_webhook_events` with `signature_valid = false` and a
 *      401 response.
 *
 *   2. Handle `endpoint.url_validation` synchronously. Zoom registers
 *      the URL by POSTing this event with a `plainToken` and rejects
 *      the URL unless we respond with `{ plainToken, encryptedToken }`
 *      where `encryptedToken = HMAC-SHA-256(plainToken, secret)`.
 *
 *   3. Persist + dispatch every other event. We always insert a row
 *      in `zoom_webhook_events` first (audit trail), then call the
 *      handler for that event type and update the row's
 *      `processing_status`. The receiver returns 200 even when a
 *      handler fails so Zoom doesn't retry the same delivery for
 *      hours; the failed row is replayable via the cron worker.
 *
 * Middleware allowlists this path (`/api/zoom/webhook`) so the
 * receiver runs without a Hub auth session.
 *
 * Reference:
 *   https://developers.zoom.us/docs/api/rest/webhook-reference/
 */

import { NextResponse } from "next/server"
import {
  buildUrlValidationResponse,
  markWebhookEvent,
  persistWebhookEvent,
  verifyZoomSignature,
  type ZoomWebhookPayload,
} from "@/lib/zoom-webhook"
import { handleZoomEvent } from "@/lib/zoom-webhook-handlers"

const SECRET = process.env.ZOOM_WEBHOOK_SECRET_TOKEN

// Headers that are useful for debugging Zoom delivery issues. We don't
// store the entire `Headers` object (it includes infrastructure-only
// fields like x-vercel-* that bloat the audit log).
const HEADERS_TO_LOG = [
  "x-zm-signature",
  "x-zm-request-timestamp",
  "x-zm-trackingid",
  "user-agent",
  "content-type",
]

export async function POST(request: Request) {
  // Read once, parse twice — verifyZoomSignature requires the exact
  // bytes Zoom signed, before any JSON.parse normalization.
  const rawBody = await request.text()

  const signature = request.headers.get("x-zm-signature")
  const timestamp = request.headers.get("x-zm-request-timestamp")
  const headers = collectHeaders(request)

  if (!SECRET) {
    console.error("[v0] [Zoom Webhook] ZOOM_WEBHOOK_SECRET_TOKEN is not configured")
    return NextResponse.json({ error: "webhook_not_configured" }, { status: 500 })
  }

  // ─── Signature verification ────────────────────────────────────────
  const verification = verifyZoomSignature(rawBody, signature, timestamp, SECRET)

  // ─── Parse JSON ────────────────────────────────────────────────────
  let payload: ZoomWebhookPayload
  try {
    payload = JSON.parse(rawBody) as ZoomWebhookPayload
  } catch {
    // Always log to the audit table when something delivered a body
    // we can't parse — even if the signature was invalid.
    await persistWebhookEvent({
      payload: { event: "invalid_json" } as ZoomWebhookPayload,
      rawBody,
      headers,
      signatureValid: verification.valid,
      signatureError: verification.valid ? "invalid_json_body" : verification.reason,
    })
    return NextResponse.json({ error: "invalid_json" }, { status: 400 })
  }

  // ─── URL validation handshake (special case) ──────────────────────
  // Zoom sends this BEFORE the subscription is active, so we still
  // verify the signature first — if the secret doesn't match what's
  // configured in the Marketplace app, the URL won't validate either.
  if (payload.event === "endpoint.url_validation" && verification.valid) {
    const plainToken =
      (payload.payload as { plainToken?: string } | undefined)?.plainToken ?? ""
    const response = buildUrlValidationResponse(plainToken, SECRET)
    console.log("[v0] [Zoom Webhook] url_validation handshake responded")
    // We log the handshake to the audit table too so installs are
    // easy to debug, but mark it as 'succeeded' immediately.
    const id = await persistWebhookEvent({
      payload,
      rawBody,
      headers,
      signatureValid: true,
    })
    if (id) await markWebhookEvent(id, "succeeded")
    return NextResponse.json(response)
  }

  // ─── Persist the event row regardless of signature validity ────────
  const eventId = await persistWebhookEvent({
    payload,
    rawBody,
    headers,
    signatureValid: verification.valid,
    signatureError: verification.valid ? undefined : verification.reason,
  })

  if (!verification.valid) {
    console.warn(
      `[v0] [Zoom Webhook] Rejecting unsigned/invalid delivery: event=${payload.event} reason=${verification.reason}`,
    )
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 })
  }

  // ─── Dispatch ─────────────────────────────────────────────────────
  // The handler runs synchronously inside the request: Vercel's
  // serverless functions are single-shot, so we can't background it
  // without losing observability. Most Zoom events finish in well
  // under a second; the redrive worker handles outliers.
  try {
    const result = await handleZoomEvent(payload)
    if (eventId) {
      await markWebhookEvent(
        eventId,
        result.ok ? (result.action === "skipped" ? "skipped" : "succeeded") : "failed",
        result.ok ? undefined : result.error,
      )
    }
    if (!result.ok) {
      console.error(
        `[v0] [Zoom Webhook] Handler failed for ${payload.event}: ${result.error}`,
      )
    }
    // Return 200 even on handler failure — Zoom's retry policy will
    // re-deliver any 4xx/5xx, but we already have the row stored and
    // can replay it ourselves without thrashing Zoom's queue.
    return NextResponse.json({ ok: result.ok, event: payload.event, action: result.action })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[v0] [Zoom Webhook] Unhandled exception:", err)
    if (eventId) await markWebhookEvent(eventId, "failed", message)
    // Still return 200 so we own retry semantics, not Zoom.
    return NextResponse.json({ ok: false, error: "handler_exception" })
  }
}

/**
 * GET is convenient for ops: hit the URL in a browser to confirm the
 * route is up and the secret is wired in without leaking it.
 */
export async function GET() {
  return NextResponse.json({
    status: "active",
    receiver: "zoom",
    secretConfigured: Boolean(SECRET),
    handledEvents: [
      "endpoint.url_validation",
      "recording.completed",
      "recording.transcript_completed",
      "meeting.started",
      "meeting.ended",
      "meeting.summary_completed",
      "app.deauthorized",
    ],
  })
}

function collectHeaders(request: Request): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of HEADERS_TO_LOG) {
    const v = request.headers.get(name)
    if (v) out[name] = v
  }
  return out
}
