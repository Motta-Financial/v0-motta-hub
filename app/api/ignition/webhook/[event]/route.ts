/**
 * DEPRECATED — Zapier-era Ignition webhook receiver.
 *
 * This endpoint was the inbound surface for Zapier "Webhooks by Zapier"
 * actions when Ignition had no public API. Ignition now exposes a first-
 * party Reporting API and we sync incrementally on a 15-minute cron
 * (/api/cron/ignition-sync), so live push from Zapier is no longer needed.
 *
 * We keep the route mounted for two reasons:
 *
 *   1. Any Zap that's still pointed at us doesn't 404 silently — Zapier
 *      will see an HTTP 410 and the user can disable the broken Zap in the
 *      Ignition admin.
 *
 *   2. We continue to record every inbound POST to `ignition_webhook_events`
 *      with `processing_status = 'deprecated'` so the admin UI can show
 *      operators how much traffic is still hitting the legacy endpoint
 *      (and which Zaps to disable). The audit table itself is now a
 *      historical archive — handlers.ts and id-resolver.ts have been moved
 *      to lib/ignition/_archived/.
 *
 * To fully retire this route once Zapier traffic has stopped:
 *   - Delete this file
 *   - Drop the IGNITION_WEBHOOK_SECRET env var
 *   - Drop or archive the `ignition_webhook_events` table
 */
import { NextRequest, NextResponse } from "next/server"
import { tryCreateAdminClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const DEPRECATION_MESSAGE =
  "The Ignition Zapier webhook bridge is retired. Live data is now polled from the Ignition Reporting API every 15 minutes (see /admin/ignition). Disable this Zap in your Ignition Zapier account."

async function logDeprecatedHit(
  req: NextRequest,
  event: string,
  rawText: string,
): Promise<void> {
  // Best-effort: don't let logging failures block the 410 response.
  const supabase = tryCreateAdminClient()
  if (!supabase) return

  let payload: Record<string, unknown> = {}
  if (rawText.trim()) {
    try {
      payload = JSON.parse(rawText)
    } catch {
      payload = { _raw: rawText }
    }
  }

  const resourceId =
    (payload as Record<string, unknown>).proposal_id ??
    (payload as Record<string, unknown>).client_id ??
    (payload as Record<string, unknown>).invoice_id ??
    (payload as Record<string, unknown>).payment_id ??
    null

  await supabase
    .from("ignition_webhook_events")
    .insert({
      event_type: event,
      ignition_resource_id: resourceId ? String(resourceId) : null,
      received_at: new Date().toISOString(),
      processed_at: new Date().toISOString(),
      processing_status: "deprecated",
      processing_error: "Zapier bridge retired — record archived but not processed",
      source_ip:
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        req.headers.get("x-real-ip") ||
        null,
      raw_payload: payload,
      request_headers: Object.fromEntries(req.headers.entries()),
    })
    .then(({ error }) => {
      if (error) {
        console.warn("[ignition-webhook:deprecated] failed to log:", error.message)
      }
    })
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ event: string }> },
) {
  const { event } = await ctx.params
  const rawText = await req.text().catch(() => "")

  // Fire-and-forget the audit insert so we always return promptly.
  void logDeprecatedHit(req, event, rawText)

  // HTTP 410 Gone tells Zapier (and humans) this endpoint is permanently
  // retired. Zapier surfaces non-2xx responses to the user as Zap errors,
  // which is exactly the signal we want.
  return NextResponse.json(
    {
      deprecated: true,
      event,
      message: DEPRECATION_MESSAGE,
    },
    { status: 410 },
  )
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ event: string }> }) {
  const { event } = await ctx.params
  return NextResponse.json(
    {
      deprecated: true,
      event,
      message: DEPRECATION_MESSAGE,
    },
    { status: 410 },
  )
}
