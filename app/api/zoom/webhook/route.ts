/**
 * Zoom webhook receiver — USER-MANAGED OAUTH app.
 *
 * Events from the per-user OAuth app (each team member installs the Hub
 * and we store their tokens in `zoom_connections`). Verified against
 * `ZOOM_WEBHOOK_SECRET_TOKEN`. The account-wide Server-to-Server app
 * delivers to `/api/zoom/s2s-webhook` instead.
 *
 * All verification, audit persistence, the url_validation handshake,
 * and event dispatch live in the shared `receiveZoomWebhook` helper so
 * the two app routes can never drift apart.
 *
 * Middleware allowlists this path so the receiver runs without a Hub
 * auth session.
 *
 * Reference:
 *   https://developers.zoom.us/docs/api/rest/webhook-reference/
 */

import { NextResponse } from "next/server"
import { receiveZoomWebhook } from "@/lib/zoom/webhook-receiver"

const SECRET = process.env.ZOOM_WEBHOOK_SECRET_TOKEN

export async function POST(request: Request) {
  return receiveZoomWebhook(request, {
    secrets: [{ token: SECRET ?? "", label: "user_oauth" }],
    source: "user_oauth",
  })
}

/**
 * GET is convenient for ops: hit the URL in a browser to confirm the
 * route is up and the secret is wired in without leaking it.
 */
export async function GET() {
  return NextResponse.json({
    status: "active",
    receiver: "zoom",
    app: "user_oauth",
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
