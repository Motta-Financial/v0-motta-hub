/**
 * Generic Ignition webhook receiver — one route, many event types.
 *
 * Zapier sends a separate Zap per Ignition trigger (Proposal Accepted,
 * Service Accepted, Client Created, Invoice Paid, etc.). To avoid creating
 * 18 near-identical routes we expose:
 *
 *   POST /api/ignition/webhook/<event-slug>?secret=<shared-secret>
 *
 * `<event-slug>` MUST be one of:
 *   client.created | client.updated | client.archived
 *   proposal.created | proposal.sent | proposal.accepted | proposal.completed
 *   proposal.lost | proposal.archived | proposal.revoked
 *   service.accepted | service.completed
 *   invoice.created | invoice.sent | invoice.paid | invoice.voided
 *   payment.received | payment.refunded | payment.failed
 *
 * Authentication: shared secret check, since Zapier doesn't sign requests.
 *   - Required header `x-ignition-secret` OR query param `?secret=...`
 *   - Compared against env var `IGNITION_WEBHOOK_SECRET`
 *
 * The route ALWAYS records the raw payload to `ignition_webhook_events`
 * BEFORE dispatching the handler — so even if processing fails we have a
 * replayable audit trail. The dispatcher itself is idempotent on Ignition
 * resource IDs.
 */

import { NextRequest, NextResponse } from "next/server"
import { tryCreateAdminClient } from "@/lib/supabase/server"
import { handleIgnitionEvent, type IgnitionEventType } from "@/lib/ignition/handlers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const VALID_EVENTS = new Set<IgnitionEventType>([
  "client.created",
  "client.updated",
  "client.archived",
  "proposal.created",
  "proposal.sent",
  "proposal.accepted",
  "proposal.completed",
  "proposal.lost",
  "proposal.archived",
  "proposal.revoked",
  "service.accepted",
  "service.completed",
  "invoice.created",
  "invoice.sent",
  "invoice.paid",
  "invoice.voided",
  "payment.received",
  "payment.refunded",
  "payment.failed",
])

function verifySecret(req: NextRequest): boolean {
  const expected = process.env.IGNITION_WEBHOOK_SECRET
  if (!expected) return false
  const provided =
    req.headers.get("x-ignition-secret") ||
    req.nextUrl.searchParams.get("secret") ||
    ""
  // Constant-time-ish compare: equal length + every char must match.
  if (provided.length !== expected.length) return false
  let ok = 0
  for (let i = 0; i < provided.length; i++) {
    ok |= provided.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return ok === 0
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ event: string }> },
) {
  // 1. Auth: shared secret.
  if (!verifySecret(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  // 2. Validate event type.
  const { event } = await ctx.params
  const eventType = event as IgnitionEventType
  if (!VALID_EVENTS.has(eventType)) {
    return NextResponse.json(
      { error: `unknown event '${event}'`, valid: Array.from(VALID_EVENTS) },
      { status: 400 },
    )
  }

  // 3. Parse the body. Zapier always sends JSON but we tolerate stray text.
  let payload: Record<string, unknown> = {}
  const rawText = await req.text()
  if (rawText.trim()) {
    try {
      payload = JSON.parse(rawText)
    } catch {
      // Some Zapier "Custom Request" actions send form-urlencoded — fall back to that.
      try {
        const params = new URLSearchParams(rawText)
        payload = Object.fromEntries(params)
      } catch {
        payload = { _raw: rawText }
      }
    }
  }

  // 4. Always log the raw event first.
  const supabase = tryCreateAdminClient()
  if (!supabase) {
    return NextResponse.json(
      { error: "supabase service role key not configured" },
      { status: 500 },
    )
  }

  const receivedAt = new Date().toISOString()
  const sourceIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null

  // Best-effort extraction of the Ignition resource id, only for the index.
  const resourceId =
    (payload as Record<string, unknown>).proposal_id ??
    (payload as Record<string, unknown>).client_id ??
    (payload as Record<string, unknown>).invoice_id ??
    (payload as Record<string, unknown>).payment_id ??
    null

  const { data: eventRow, error: insertErr } = await supabase
    .from("ignition_webhook_events")
    .insert({
      event_type: eventType,
      ignition_resource_id: resourceId ? String(resourceId) : null,
      received_at: receivedAt,
      processing_status: "pending",
      source_ip: sourceIp,
      raw_payload: payload,
      request_headers: Object.fromEntries(req.headers.entries()),
    })
    .select("id")
    .single()

  if (insertErr) {
    // Log the issue but still try to process — losing the audit row is
    // better than dropping a real Ignition event.
    console.error("[ignition-webhook] failed to log event:", insertErr.message)
  }

  // 5. Dispatch.
  try {
    const result = await handleIgnitionEvent(supabase, eventType, payload, receivedAt)

    if (eventRow?.id) {
      await supabase
        .from("ignition_webhook_events")
        .update({
          processed_at: new Date().toISOString(),
          processing_status: result.status,
          processing_error: result.status === "skipped" ? result.message : null,
        })
        .eq("id", eventRow.id)
    }

    return NextResponse.json({
      received: true,
      event: eventType,
      result,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (eventRow?.id) {
      await supabase
        .from("ignition_webhook_events")
        .update({
          processed_at: new Date().toISOString(),
          processing_status: "failed",
          processing_error: message.slice(0, 2000),
        })
        .eq("id", eventRow.id)
    }
    console.error("[ignition-webhook] handler failed:", message)
    // Return 200 so Zapier doesn't retry endlessly — we have the raw event
    // logged and can replay manually from the admin UI.
    return NextResponse.json({ received: true, event: eventType, error: message }, { status: 200 })
  }
}

// GET is purely for the Zapier UI's "Test webhook" step — Zapier expects a
// 2xx response, no body required. Returns the event slug so users can
// confirm they pasted the right URL.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ event: string }> }) {
  const { event } = await ctx.params
  return NextResponse.json({
    ok: true,
    event,
    usage:
      "POST JSON body with x-ignition-secret header (or ?secret=...). See /settings/ignition for setup.",
  })
}
