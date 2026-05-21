/**
 * ProConnect Webhook Receiver
 *
 * Receives real-time updates from ProConnect for:
 * - Client (Create, Update, Delete)
 * - TaxReturn (Create, Update, Delete)
 * - TaxReturnWorkStatus (Create, Update, Delete)
 *
 * Webhook payload format:
 * {
 *   "eventNotifications": [{
 *     "realmId": "...",
 *     "dataChangeEvent": {
 *       "entities": [{
 *         "name": "Client | TaxReturn | TaxReturnWorkStatus",
 *         "id": "...",
 *         "operation": "Create | Update | Delete",
 *         "lastUpdated": "..."
 *       }]
 *     }
 *   }]
 * }
 *
 * Webhook verification uses the PROCONNECT_WEBHOOK_VERIFIER_TOKEN env var.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import {
  syncSingleClient,
  deleteClient,
} from "@/lib/proconnect/sync"

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

interface WebhookEntity {
  name: string
  id: string
  operation: "Create" | "Update" | "Delete"
  lastUpdated: string
}

interface WebhookPayload {
  eventNotifications: Array<{
    realmId: string
    dataChangeEvent: {
      entities: WebhookEntity[]
    }
  }>
}

function getSupabaseAdmin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })
}

/**
 * Log webhook event to database
 */
async function logWebhookEvent(
  entity: WebhookEntity,
  realmId: string,
  payload: unknown,
  status: "pending" | "processed" | "failed",
  error?: string
): Promise<string> {
  const supabase = getSupabaseAdmin()

  const { data, error: dbError } = await supabase
    .from("proconnect_webhook_events")
    .insert({
      event_type: entity.name,
      operation: entity.operation,
      entity_id: entity.id,
      realm_id: realmId,
      raw_payload: payload,
      processing_status: status,
      processing_error: error,
      processed_at: status !== "pending" ? new Date().toISOString() : null,
    })
    .select("id")
    .single()

  if (dbError) {
    console.error(`[ProConnect Webhook] Failed to log event: ${dbError.message}`)
    return "unknown"
  }

  return data.id
}

/**
 * Update webhook event status
 */
async function updateWebhookEvent(
  eventId: string,
  status: "processed" | "failed",
  error?: string
): Promise<void> {
  const supabase = getSupabaseAdmin()

  await supabase
    .from("proconnect_webhook_events")
    .update({
      processing_status: status,
      processing_error: error,
      processed_at: new Date().toISOString(),
    })
    .eq("id", eventId)
}

/**
 * Process a Client event
 */
async function processClientEvent(
  entity: WebhookEntity
): Promise<{ success: boolean; error?: string }> {
  if (entity.operation === "Delete") {
    return deleteClient(entity.id)
  }

  // Create or Update - fetch fresh data
  return syncSingleClient(entity.id)
}

/**
 * Process a TaxReturn event
 * For now, we re-sync the entire client's engagements
 * because the engagement ID structure isn't 1:1 with the webhook entity ID
 */
async function processTaxReturnEvent(
  entity: WebhookEntity
): Promise<{ success: boolean; error?: string }> {
  // TaxReturn webhooks contain the return ID, not the client ID
  // For now, log it and rely on the nightly sync
  // TODO: Implement mapping from return ID to client ID for real-time sync
  console.log(
    `[ProConnect Webhook] TaxReturn ${entity.operation}: ${entity.id} - will sync on next full sync`
  )
  return { success: true }
}

/**
 * Process a TaxReturnWorkStatus event
 * Similar to TaxReturn - log and rely on nightly sync
 */
async function processTaxReturnWorkStatusEvent(
  entity: WebhookEntity
): Promise<{ success: boolean; error?: string }> {
  console.log(
    `[ProConnect Webhook] TaxReturnWorkStatus ${entity.operation}: ${entity.id} - will sync on next full sync`
  )
  return { success: true }
}

/**
 * Process a single webhook entity
 */
async function processEntity(
  entity: WebhookEntity,
  realmId: string,
  payload: unknown
): Promise<void> {
  const eventId = await logWebhookEvent(entity, realmId, payload, "pending")

  try {
    let result: { success: boolean; error?: string }

    switch (entity.name) {
      case "Client":
        result = await processClientEvent(entity)
        break
      case "TaxReturn":
        result = await processTaxReturnEvent(entity)
        break
      case "TaxReturnWorkStatus":
        result = await processTaxReturnWorkStatusEvent(entity)
        break
      default:
        result = { success: false, error: `Unknown entity type: ${entity.name}` }
    }

    if (result.success) {
      await updateWebhookEvent(eventId, "processed")
    } else {
      await updateWebhookEvent(eventId, "failed", result.error)
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error"
    await updateWebhookEvent(eventId, "failed", errorMessage)
  }
}

export async function POST(request: NextRequest) {
  try {
    // Verify webhook signature using Intuit verifier token
    const verifierToken =
      request.headers.get("intuit-webhook-signature") ||
      request.headers.get("verifier-token")
    const expectedToken = process.env.PROCONNECT_WEBHOOK_VERIFIER_TOKEN

    if (expectedToken && verifierToken !== expectedToken) {
      console.warn("[ProConnect Webhook] Unauthorized request - invalid verifier token")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const payload = (await request.json()) as WebhookPayload

    console.log(
      "[ProConnect Webhook] Received webhook:",
      JSON.stringify(payload).slice(0, 500)
    )

    // Validate payload structure
    if (!payload.eventNotifications || !Array.isArray(payload.eventNotifications)) {
      return NextResponse.json(
        { error: "Invalid payload structure" },
        { status: 400 }
      )
    }

    // Process each notification
    const results: Array<{ entity: string; success: boolean; error?: string }> = []

    for (const notification of payload.eventNotifications) {
      const realmId = notification.realmId
      const entities = notification.dataChangeEvent?.entities || []

      for (const entity of entities) {
        await processEntity(entity, realmId, payload)
        results.push({
          entity: `${entity.name}:${entity.id}`,
          success: true,
        })
      }
    }

    return NextResponse.json({
      received: true,
      processed: results.length,
      results,
    })
  } catch (err) {
    console.error(
      "[ProConnect Webhook] Error processing webhook:",
      err instanceof Error ? err.message : err
    )

    return NextResponse.json(
      { error: "Failed to process webhook" },
      { status: 500 }
    )
  }
}

// Respond to challenge requests (if Intuit requires endpoint verification)
export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "ProConnect webhook receiver",
  })
}
