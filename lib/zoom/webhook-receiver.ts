/**
 * Shared Zoom webhook receiver.
 *
 * Both Zoom Marketplace apps the Hub uses deliver events to the same
 * Hub deployment but on DISTINCT routes, each with its OWN signing
 * secret (configured on that app's "Feature > Event Subscriptions"
 * page):
 *
 *   - `/api/zoom/webhook`     ← user-managed OAuth app
 *                               (ZOOM_WEBHOOK_SECRET_TOKEN)
 *   - `/api/zoom/s2s-webhook` ← account-wide Server-to-Server app
 *                               (ZOOM_S2S_WEBHOOK_SECRET_TOKEN)
 *
 * The verification scheme, audit persistence, url_validation handshake,
 * and event dispatch are IDENTICAL for both — only the secret and a
 * source label differ. Rather than duplicate ~120 lines of fiddly
 * signature + handshake logic (and risk the two copies drifting), both
 * route handlers are thin wrappers around `receiveZoomWebhook`.
 *
 * A receiver may be handed MORE than one candidate secret. It accepts a
 * delivery if ANY candidate verifies, and — critically — answers the
 * `endpoint.url_validation` challenge with the SAME secret that
 * verified. That lets a single URL safely serve multiple apps if we
 * ever consolidate, without breaking either app's validation.
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

export interface WebhookSecretCandidate {
  /** The signing secret token from the Zoom app's event subscription. */
  token: string
  /** Human label for logs/audit (e.g. "user_oauth", "s2s"). */
  label: string
}

export interface ReceiveOptions {
  /**
   * Candidate signing secrets. The delivery is accepted if ANY of these
   * verifies the signature. Undefined/empty tokens are skipped.
   */
  secrets: WebhookSecretCandidate[]
  /** Source label stamped into the audit log (which app delivered this). */
  source: string
}

// Headers worth keeping for debugging Zoom delivery issues. We avoid
// storing the full Headers object (it carries infra-only x-vercel-*
// fields that bloat the audit log).
const HEADERS_TO_LOG = [
  "x-zm-signature",
  "x-zm-request-timestamp",
  "x-zm-trackingid",
  "user-agent",
  "content-type",
]

export async function receiveZoomWebhook(
  request: Request,
  opts: ReceiveOptions,
): Promise<Response> {
  // Read once: verifyZoomSignature requires the EXACT bytes Zoom signed,
  // before any JSON.parse normalization.
  const rawBody = await request.text()
  const signature = request.headers.get("x-zm-signature")
  const timestamp = request.headers.get("x-zm-request-timestamp")
  const headers = collectHeaders(request, opts.source)

  const candidates = opts.secrets.filter((s) => Boolean(s.token))
  if (candidates.length === 0) {
    console.error(
      `[v0] [Zoom Webhook:${opts.source}] No signing secret configured — set the env var for this app.`,
    )
    return NextResponse.json({ error: "webhook_not_configured" }, { status: 500 })
  }

  // ─── Signature verification (try each candidate) ───────────────────
  let matchedSecret: WebhookSecretCandidate | null = null
  let lastReason: string | undefined
  for (const cand of candidates) {
    const v = verifyZoomSignature(rawBody, signature, timestamp, cand.token)
    if (v.valid) {
      matchedSecret = cand
      break
    }
    lastReason = v.reason
  }
  const signatureValid = matchedSecret !== null

  // ─── Parse JSON ────────────────────────────────────────────────────
  let payload: ZoomWebhookPayload
  try {
    payload = JSON.parse(rawBody) as ZoomWebhookPayload
  } catch {
    await persistWebhookEvent({
      payload: { event: "invalid_json" } as ZoomWebhookPayload,
      rawBody,
      headers,
      signatureValid,
      signatureError: signatureValid ? "invalid_json_body" : lastReason,
    })
    return NextResponse.json({ error: "invalid_json" }, { status: 400 })
  }

  // ─── URL validation handshake ──────────────────────────────────────
  // Zoom sends this the moment a webhook URL is registered, signed with
  // the app's secret. We answer with the secret that verified.
  if (payload.event === "endpoint.url_validation" && matchedSecret) {
    const plainToken =
      (payload.payload as { plainToken?: string } | undefined)?.plainToken ?? ""
    const response = buildUrlValidationResponse(plainToken, matchedSecret.token)
    console.log(
      `[v0] [Zoom Webhook:${opts.source}] url_validation handshake responded (secret=${matchedSecret.label})`,
    )
    const id = await persistWebhookEvent({ payload, rawBody, headers, signatureValid: true })
    if (id) await markWebhookEvent(id, "succeeded")
    return NextResponse.json(response)
  }

  // ─── Persist regardless of signature validity (audit trail) ────────
  const eventId = await persistWebhookEvent({
    payload,
    rawBody,
    headers,
    signatureValid,
    signatureError: signatureValid ? undefined : lastReason,
  })

  if (!signatureValid) {
    console.warn(
      `[v0] [Zoom Webhook:${opts.source}] Rejecting unsigned/invalid delivery: event=${payload.event} reason=${lastReason}`,
    )
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 })
  }

  // ─── Dispatch ──────────────────────────────────────────────────────
  // Handlers run synchronously: Vercel functions are single-shot, so we
  // can't background them without losing observability. Most events
  // finish well under a second; the redrive worker handles outliers.
  // We return 200 even on handler failure so WE own retry semantics
  // (the row is stored + replayable) instead of Zoom hammering us.
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
        `[v0] [Zoom Webhook:${opts.source}] Handler failed for ${payload.event}: ${result.error}`,
      )
    }
    return NextResponse.json({ ok: result.ok, event: payload.event, action: result.action })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[v0] [Zoom Webhook:${opts.source}] Unhandled exception:`, err)
    if (eventId) await markWebhookEvent(eventId, "failed", message)
    return NextResponse.json({ ok: false, error: "handler_exception" })
  }
}

function collectHeaders(request: Request, source: string): Record<string, string> {
  const out: Record<string, string> = { "x-hub-webhook-source": source }
  for (const name of HEADERS_TO_LOG) {
    const v = request.headers.get(name)
    if (v) out[name] = v
  }
  return out
}
