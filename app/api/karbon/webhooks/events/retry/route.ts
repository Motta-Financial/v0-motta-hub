import { type NextRequest, NextResponse } from "next/server"
import { tryCreateAdminClient } from "@/lib/supabase/server"
import { processWebhookEvent } from "@/lib/karbon/process-webhook-event"

/**
 * Manually retry a failed (or any) webhook event.
 *
 * POST body: { event_ids: string[] } OR { all_failed: true }
 *
 * Used by the admin UI to re-process events that exceeded their automatic retry
 * budget, or to flush a backlog after a Karbon API outage. Re-runs go through
 * the same `processWebhookEvent` pipeline, which is idempotent (upserts by
 * perma_key), so retrying a successful event is harmless.
 */
export async function POST(request: NextRequest) {
  const supabase = tryCreateAdminClient()
  if (!supabase) {
    return NextResponse.json({ error: "Supabase admin client unavailable" }, { status: 500 })
  }

  let body: { event_ids?: string[]; all_failed?: boolean; max?: number } = {}
  try {
    body = await request.json()
  } catch {
    // empty body is fine
  }

  // Resolve the working set of events
  let eventsQuery = supabase
    .from("karbon_webhook_events")
    .select("id, resource_type, action_type, resource_perma_key, parent_entity_key, client_key, client_type, retry_count")
    .order("event_timestamp", { ascending: true })
    .limit(Math.min(body.max ?? 50, 200))

  if (Array.isArray(body.event_ids) && body.event_ids.length > 0) {
    eventsQuery = eventsQuery.in("id", body.event_ids)
  } else if (body.all_failed) {
    eventsQuery = eventsQuery.eq("status", "failed")
  } else {
    return NextResponse.json(
      { error: "Provide either { event_ids: [...] } or { all_failed: true }" },
      { status: 400 },
    )
  }

  const { data: events, error } = await eventsQuery
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!events || events.length === 0) {
    return NextResponse.json({ replayed: 0, message: "No matching events" })
  }

  // Reset to pending so the processor will re-enter the work
  await supabase
    .from("karbon_webhook_events")
    .update({ status: "pending", error_message: null })
    .in(
      "id",
      events.map((e) => e.id),
    )

  // Process serially so we don't burst Karbon's API. The whole batch typically
  // finishes in a few seconds for ~50 events; the route runs on the default
  // server runtime (no edge), so we have generous headroom.
  let succeeded = 0
  let failed = 0
  for (const event of events) {
    try {
      await processWebhookEvent(event as any)
      succeeded++
    } catch (err) {
      console.error("[webhook-retry] event", event.id, err)
      failed++
    }
  }

  return NextResponse.json({
    replayed: events.length,
    succeeded,
    failed,
  })
}
