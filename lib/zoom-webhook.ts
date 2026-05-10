/**
 * Zoom webhook verification + persistence helpers.
 *
 * Zoom signs every webhook delivery with HMAC-SHA-256 over the body,
 * including the timestamp of the request, using the secret token shown
 * on the "Feature > Event Subscriptions" page in the Zoom Marketplace
 * app. The signature is sent in the `x-zm-signature` header alongside
 * `x-zm-request-timestamp`. Endpoints that fail to verify the signature
 * MUST return 401 — Zoom will retry with backoff for hours, so a leaky
 * receiver is not just a security issue, it's also a performance one.
 *
 * Reference:
 *   https://developers.zoom.us/docs/api/rest/webhook-reference/#verify-with-zooms-header
 *
 * One special event — `endpoint.url_validation` — is sent the moment a
 * webhook URL is registered. The body contains a `plainToken` and we
 * must respond with `{ plainToken, encryptedToken }` where
 * `encryptedToken = HMAC-SHA-256(plainToken, secret).toString('hex')`.
 * Zoom rejects the URL if we get this wrong, so it has its own helper
 * here.
 */

import { createHmac, timingSafeEqual } from "node:crypto"
import { createAdminClient } from "@/lib/supabase/server"

// Window of acceptable clock skew between Zoom and us, in seconds.
// Zoom recommends 5 minutes; we use the same.
const TIMESTAMP_TOLERANCE_SECONDS = 300

export interface ZoomWebhookVerification {
  valid: boolean
  reason?: string
}

/**
 * Verify a Zoom webhook delivery. The signature scheme is documented
 * here: https://developers.zoom.us/docs/api/rest/webhook-reference/#verify-with-zooms-header
 *
 * Steps:
 *   1. Build the message string: `v0:{timestamp}:{rawBody}`
 *   2. Compute HMAC-SHA-256 over the message using the secret token
 *   3. Compare against the header value `v0={hex}` using a timing-safe
 *      comparison
 *   4. Reject if the timestamp is outside the tolerance window (replay
 *      protection)
 */
export function verifyZoomSignature(
  rawBody: string,
  signatureHeader: string | null,
  timestampHeader: string | null,
  secret: string,
): ZoomWebhookVerification {
  if (!signatureHeader) return { valid: false, reason: "missing_signature_header" }
  if (!timestampHeader) return { valid: false, reason: "missing_timestamp_header" }
  if (!secret) return { valid: false, reason: "secret_not_configured" }

  const ts = Number(timestampHeader)
  if (!Number.isFinite(ts)) return { valid: false, reason: "invalid_timestamp_header" }

  // Replay protection.
  const nowSec = Math.floor(Date.now() / 1000)
  if (Math.abs(nowSec - ts) > TIMESTAMP_TOLERANCE_SECONDS) {
    return { valid: false, reason: "timestamp_outside_tolerance" }
  }

  const message = `v0:${timestampHeader}:${rawBody}`
  const expected = createHmac("sha256", secret).update(message, "utf8").digest("hex")
  const expectedHeader = `v0=${expected}`

  // Always compare buffers of equal length — `timingSafeEqual` throws
  // when lengths differ, which would itself leak length info.
  const a = Buffer.from(signatureHeader)
  const b = Buffer.from(expectedHeader)
  if (a.length !== b.length) return { valid: false, reason: "signature_mismatch" }
  if (!timingSafeEqual(a, b)) return { valid: false, reason: "signature_mismatch" }

  return { valid: true }
}

/**
 * Build the response body for the `endpoint.url_validation` challenge.
 * Zoom sends `{ event: 'endpoint.url_validation', payload: { plainToken } }`
 * and expects `{ plainToken, encryptedToken }` back, both as JSON, where
 * `encryptedToken` is the hex HMAC of `plainToken` with our secret.
 */
export function buildUrlValidationResponse(
  plainToken: string,
  secret: string,
): { plainToken: string; encryptedToken: string } {
  const encryptedToken = createHmac("sha256", secret).update(plainToken, "utf8").digest("hex")
  return { plainToken, encryptedToken }
}

/* ─────────────────────────────────────────────────────────────────────
 * zoom_webhook_events helpers
 * ───────────────────────────────────────────────────────────────────── */

export interface ZoomWebhookPayload {
  event: string
  event_ts?: number
  payload?: {
    account_id?: string
    object?: {
      id?: string | number
      uuid?: string
      host_id?: string
      host_email?: string
      account_id?: string
      [k: string]: unknown
    }
    plainToken?: string
    [k: string]: unknown
  }
  download_token?: string
  [k: string]: unknown
}

interface PersistEventArgs {
  payload: ZoomWebhookPayload
  rawBody: string
  headers: Record<string, string>
  signatureValid: boolean
  signatureError?: string
}

/**
 * Persist a single inbound webhook to `zoom_webhook_events`. Always
 * writes a row, even when signature verification failed, so we can
 * audit attacks and debug Zoom misconfiguration after the fact.
 *
 * Returns the inserted row id (or null if the insert itself failed,
 * which we tolerate — the receiver still 200s so Zoom doesn't retry).
 */
export async function persistWebhookEvent(args: PersistEventArgs): Promise<string | null> {
  const { payload, headers, signatureValid, signatureError } = args
  const admin = createAdminClient()

  const obj = payload.payload?.object ?? {}
  const meetingIdRaw = obj.id
  const meetingIdNumeric =
    typeof meetingIdRaw === "number"
      ? meetingIdRaw
      : typeof meetingIdRaw === "string" && /^\d+$/.test(meetingIdRaw)
      ? Number(meetingIdRaw)
      : null

  const eventTs = payload.event_ts
    ? new Date(payload.event_ts).toISOString()
    : null

  const { data, error } = await admin
    .from("zoom_webhook_events")
    .insert({
      event_type: payload.event ?? "unknown",
      event_ts: eventTs,
      zoom_account_id: payload.payload?.account_id ?? obj.account_id ?? null,
      zoom_user_id: typeof obj.host_id === "string" ? obj.host_id : null,
      zoom_meeting_id: meetingIdNumeric,
      zoom_meeting_uuid: typeof obj.uuid === "string" ? obj.uuid : null,
      raw_payload: payload as unknown as Record<string, unknown>,
      request_headers: headers,
      signature_valid: signatureValid,
      signature_error: signatureError ?? null,
      processing_status: signatureValid ? "pending" : "failed",
      processing_error: signatureValid ? null : signatureError ?? "signature_invalid",
    })
    .select("id")
    .single()

  if (error) {
    console.error("[v0] [Zoom Webhook] Failed to persist event row:", error)
    return null
  }
  return (data as { id: string }).id
}

/** Mark a previously persisted webhook event with its terminal status. */
export async function markWebhookEvent(
  eventId: string,
  status: "succeeded" | "failed" | "skipped",
  error?: string,
): Promise<void> {
  const admin = createAdminClient()
  const { error: updateError } = await admin
    .from("zoom_webhook_events")
    .update({
      processing_status: status,
      processing_error: error ?? null,
      processed_at: new Date().toISOString(),
    })
    .eq("id", eventId)
  if (updateError) {
    console.error(`[v0] [Zoom Webhook] Failed to mark event ${eventId} as ${status}:`, updateError)
  }
}
