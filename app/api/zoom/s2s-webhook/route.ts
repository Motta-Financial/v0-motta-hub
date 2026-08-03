/**
 * Zoom webhook receiver — ACCOUNT-WIDE SERVER-TO-SERVER app.
 *
 * The S2S app (ZOOM_S2S_CLIENT_ID/SECRET/ACCOUNT_ID) can subscribe to
 * account-level events for EVERY user — including teammates who never
 * personally connected the Hub via OAuth. That makes new recordings,
 * transcripts, and AI summaries land in the Hub the instant Zoom
 * finishes processing them, instead of waiting for the daily account
 * sweep (`/api/zoom/recordings/sync-account`).
 *
 * Verified against `ZOOM_S2S_WEBHOOK_SECRET_TOKEN` — the secret on the
 * S2S app's "Feature > Event Subscriptions" page (DISTINCT from the
 * user-OAuth app's `ZOOM_WEBHOOK_SECRET_TOKEN`). Falls back to the
 * user-OAuth secret as a second candidate so a misrouted delivery is
 * still accepted and audited rather than silently 401'd.
 *
 * Dispatch is shared with the user-OAuth route via `receiveZoomWebhook`
 * → `handleZoomEvent`. The handlers already tolerate a NULL connection
 * (account-wide hosts have no `zoom_connections` row), attributing
 * recordings by host email/id instead.
 *
 * Recommended event subscriptions on the S2S app:
 *   - recording.completed
 *   - recording.transcript_completed
 *   - meeting.summary_completed   (Zoom AI Companion)
 *   - meeting.started / meeting.ended
 *
 * Middleware allowlists this path so the receiver runs without a Hub
 * auth session.
 */

import { NextResponse } from "next/server"
import { receiveZoomWebhook } from "@/lib/zoom/webhook-receiver"

const S2S_SECRET = process.env.ZOOM_S2S_WEBHOOK_SECRET_TOKEN
const OAUTH_SECRET = process.env.ZOOM_WEBHOOK_SECRET_TOKEN

export async function POST(request: Request) {
  return receiveZoomWebhook(request, {
    // S2S secret is the primary; the OAuth secret is a defensive
    // fallback so a delivery sent to the wrong URL is still verified
    // and audited rather than rejected.
    secrets: [
      { token: S2S_SECRET ?? "", label: "s2s" },
      { token: OAUTH_SECRET ?? "", label: "user_oauth_fallback" },
    ],
    source: "s2s",
  })
}

/**
 * GET is convenient for ops: confirm the route is up and which secret
 * is wired in without leaking it.
 */
export async function GET() {
  return NextResponse.json({
    status: "active",
    receiver: "zoom",
    app: "s2s",
    secretConfigured: Boolean(S2S_SECRET),
    handledEvents: [
      "endpoint.url_validation",
      "recording.completed",
      "recording.transcript_completed",
      "meeting.started",
      "meeting.ended",
      "meeting.summary_completed",
    ],
  })
}
