/**
 * Karbon webhook receiver — single endpoint for all WebhookTypes.
 *
 * Per the Karbon API spec, the inbound payload shape is:
 *   {
 *     ResourcePermaKey: string,
 *     ResourceType: 'Contact' | 'Organization' | 'ClientGroup' | 'Work' | 'Note' | 'NoteComment' |
 *                   'User' | 'IntegrationTask' | 'Invoice' | 'Estimate' | 'EstimateSummary' |
 *                   'CustomFieldValue',
 *     ActionType: 'Inserted' | 'Modified' | 'Deleted',
 *     TimeStamp: ISO8601,
 *     ParentEntityKey?: string,    // NoteComment payloads
 *     ClientKey?: string,          // IntegrationTask / CustomFieldValue payloads
 *     ClientType?: 'Contact' | 'Organization',
 *   }
 *
 * Goals:
 *   1. Verify signature (when KARBON_WEBHOOK_SIGNING_KEY is set).
 *   2. Idempotently insert the event into karbon_webhook_events.
 *   3. Return 200 in <1s — never 5xx (Karbon cancels subs after 10 failures).
 *   4. Process asynchronously via waitUntil so the row updates eventually drive
 *      Supabase Realtime channels and the UI updates live.
 */
import { type NextRequest, NextResponse } from "next/server"
import { createHmac, timingSafeEqual } from "node:crypto"
import { waitUntil } from "@vercel/functions"
import { tryCreateAdminClient } from "@/lib/supabase/server"
import { processWebhookEvent } from "@/lib/karbon/process-webhook-event"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface KarbonWebhookPayload {
  ResourcePermaKey: string
  ResourceType: string
  ActionType: string
  TimeStamp: string
  ParentEntityKey?: string
  ClientKey?: string
  ClientType?: string
}

function verifySignature(rawBody: string, headerSig: string | null, signingKey: string): boolean {
  if (!headerSig) return false
  const computed = createHmac("sha256", signingKey).update(rawBody, "utf8").digest("hex")
  try {
    const a = Buffer.from(computed, "hex")
    const b = Buffer.from(headerSig.replace(/^sha256=/i, ""), "hex")
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

function resourceTypeToWebhookType(resourceType: string): string | null {
  switch (resourceType) {
    case "Contact":
    case "Organization":
    case "ClientGroup":
      return "Contact"
    case "Work":
      return "Work"
    case "Note":
    case "NoteComment":
      return "Note"
    case "User":
      return "User"
    case "IntegrationTask":
      return "IntegrationTask"
    case "Invoice":
      return "Invoice"
    case "Estimate":
    case "EstimateSummary":
      return "EstimateSummary"
    case "CustomField":
    case "CustomFieldValue":
      return "CustomField"
    default:
      return null
  }
}

export async function POST(request: NextRequest) {
  // 1. Read raw body (needed for HMAC)
  const rawBody = await request.text()

  // 2. Verify signature if a key is configured
  const signingKey = process.env.KARBON_WEBHOOK_SIGNING_KEY
  let signatureValid: boolean | null = null
  if (signingKey) {
    const headerSig =
      request.headers.get("x-karbon-signature") ||
      request.headers.get("x-karbon-signature-256") ||
      request.headers.get("karbon-signature")
    signatureValid = verifySignature(rawBody, headerSig, signingKey)
    if (!signatureValid) {
      console.warn("[karbon-webhook] Invalid signature — rejecting")
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
    }
  }

  // 3. Parse payload
  let payload: KarbonWebhookPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (!payload.ResourcePermaKey || !payload.ResourceType || !payload.ActionType || !payload.TimeStamp) {
    return NextResponse.json(
      { error: "Missing required fields (ResourcePermaKey, ResourceType, ActionType, TimeStamp)" },
      { status: 400 },
    )
  }

  // 4. Persist with idempotent insert
  const db = tryCreateAdminClient()
  if (!db) {
    console.error("[karbon-webhook] Supabase admin client not available — dropping event")
    return NextResponse.json({ ok: true, dropped: true })
  }

  const { data: inserted, error: insertErr } = await db
    .from("karbon_webhook_events")
    .insert({
      resource_type: payload.ResourceType,
      action_type: payload.ActionType,
      resource_perma_key: payload.ResourcePermaKey,
      parent_entity_key: payload.ParentEntityKey || null,
      client_key: payload.ClientKey || null,
      client_type: payload.ClientType || null,
      event_timestamp: payload.TimeStamp,
      raw_payload: payload as any,
      signature_valid: signatureValid,
      processing_status: "pending",
    })
    .select(
      "id, resource_type, action_type, resource_perma_key, parent_entity_key, client_key, client_type, retry_count",
    )
    .single()

  // Idempotency: unique index on (perma_key, action_type, event_timestamp) catches retries
  if (insertErr) {
    if ((insertErr as any).code === "23505") {
      return NextResponse.json({ ok: true, duplicate: true })
    }
    console.error("[karbon-webhook] Insert failed:", insertErr.message)
    // 200 anyway — don't let Karbon cancel the sub over a transient DB hiccup
    return NextResponse.json({ ok: false, error: insertErr.message }, { status: 200 })
  }

  // 5. Touch subscription liveness
  const webhookType = resourceTypeToWebhookType(payload.ResourceType)
  if (webhookType) {
    waitUntil(
      (async () => {
        await db
          .from("karbon_webhook_subscriptions")
          .update({ last_event_at: new Date().toISOString() })
          .eq("webhook_type", webhookType)
      })(),
    )
  }

  // 6. Process asynchronously
  if (inserted) {
    waitUntil(
      processWebhookEvent(inserted as any).catch((e) => {
        console.error("[karbon-webhook] Processor error:", e?.message || e)
      }),
    )
  }

  return NextResponse.json({ ok: true, eventId: inserted?.id })
}

/**
 * Health/info endpoint — current subs + most recent events.
 */
export async function GET() {
  const db = tryCreateAdminClient()
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 })

  const [{ data: subs }, { data: events }] = await Promise.all([
    db.from("karbon_webhook_subscriptions").select("*").order("webhook_type", { ascending: true }),
    db
      .from("karbon_webhook_events")
      .select(
        "id, resource_type, action_type, resource_perma_key, processing_status, received_at, processed_at, processing_error",
      )
      .order("received_at", { ascending: false })
      .limit(25),
  ])

  return NextResponse.json({ subscriptions: subs || [], recentEvents: events || [] })
}
