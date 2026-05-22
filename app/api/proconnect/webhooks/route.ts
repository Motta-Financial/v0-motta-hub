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
import { createHmac, timingSafeEqual } from "node:crypto"
import {
  syncSingleClient,
  deleteClient,
} from "@/lib/proconnect/sync"
import { exportReturnData, flattenSeriesMap } from "@/lib/proconnect/data"

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
 * Process a TaxReturn event.
 *
 * The webhook delivers the return UUID as `entity.id`. We map it to a
 * client id via `proconnect_engagements.engagement_id` (which IS the
 * return UUID — confirmed against the live data model) and trigger a
 * Phase 1 export so the snapshot stays consistent with PTO. Delete
 * tombstones the snapshot row rather than dropping it, so the audit
 * trail in proconnect_import_jobs still resolves.
 */
async function processTaxReturnEvent(
  entity: WebhookEntity
): Promise<{ success: boolean; error?: string }> {
  const sb = getSupabaseAdmin()
  const { data: eng, error: engErr } = await sb
    .from("proconnect_engagements")
    .select("proconnect_client_id")
    .eq("engagement_id", entity.id)
    .maybeSingle()

  if (engErr) {
    return { success: false, error: `engagement lookup failed: ${engErr.message}` }
  }
  if (!eng) {
    // Webhook may arrive before the engagement is synced. Engagement
    // sync will pick it up on its own; we don't fail the webhook.
    console.log(`[ProConnect Webhook] TaxReturn ${entity.id} not yet in proconnect_engagements; skipping snapshot refresh`)
    return { success: true }
  }
  const clientId = eng.proconnect_client_id as string

  if (entity.operation === "Delete") {
    // Tombstone: keep snapshot row but null out cells. We don't delete
    // because import_jobs.return_id references it and we want to keep
    // that history queryable for compliance.
    await sb
      .from("proconnect_return_snapshots")
      .update({ deleted_at: new Date().toISOString() })
      .eq("return_id", entity.id)
    await sb.from("proconnect_return_field_cells").delete().eq("return_id", entity.id)
    return { success: true }
  }

  // Create / Update: refresh the snapshot. Errors here shouldn't fail
  // the webhook (Intuit will retry the whole thing) — log and move on.
  try {
    const result = await exportReturnData(clientId, entity.id)
    if (!result.ok) {
      console.warn(
        `[ProConnect Webhook] TaxReturn ${entity.id} export failed: ${result.error.kind} ${result.error.status}`
      )
      return { success: true } // soft-fail; nightly sync will retry
    }
    const exp = result.data
    const flatCells = flattenSeriesMap(exp.data)

    const { data: snap, error: snapErr } = await sb
      .from("proconnect_return_snapshots")
      .upsert(
        {
          return_id: entity.id,
          proconnect_client_id: clientId,
          return_name: exp.name ?? null,
          client_name: exp.clientName ?? null,
          tax_year: exp.year ?? null,
          return_type: exp.type ?? null,
          version: exp.version ?? null,
          series_versions: exp.seriesVersion ?? [],
          efile_items: exp.efileItems ?? [],
          agencies: exp.agency ?? [],
          firm_id: exp.id_firm ?? null,
          proconnect_created_by: exp.createdBy ?? null,
          proconnect_created_time: exp.createdTime
            ? new Date(exp.createdTime).toISOString()
            : null,
          raw_data: exp.data ?? null,
          exported_at: new Date().toISOString(),
          deleted_at: null,
        },
        { onConflict: "proconnect_client_id,return_id" }
      )
      .select("id")
      .single()
    if (snapErr) {
      return { success: false, error: `snapshot upsert failed: ${snapErr.message}` }
    }
    const snapshotId = snap.id as string

    await sb.from("proconnect_return_field_cells").delete().eq("return_id", entity.id)
    if (flatCells.length > 0) {
      const rows = flatCells.map((c) => ({
        snapshot_id: snapshotId,
        return_id: entity.id,
        series_id: c.seriesId,
        prefix_id: c.prefixId,
        code_id: c.codeId,
        suffix_id: c.suffixId,
        val: c.cell.val ?? null,
        description: c.cell.desc ?? null,
        src: c.cell.src ?? null,
        tsj: c.cell.tsj ?? null,
        scope: c.cell.scope ?? null,
        source: c.cell.source ?? null,
        city_abbrev: c.cell.cityAbbrev ?? null,
        import_source: c.cell.importSource ?? null,
        raw_cell: c.cell,
      }))
      for (let i = 0; i < rows.length; i += 1000) {
        await sb.from("proconnect_return_field_cells").insert(rows.slice(i, i + 1000))
      }
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
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

/**
 * Verify Intuit webhook signature.
 *
 * Per Intuit Developer docs, webhooks include an `intuit-signature` header
 * containing the base64-encoded HMAC-SHA256 of the raw request body, signed
 * with the app's verifier token. We must compare that value against a
 * locally-computed signature using the same verifier token.
 *
 * Reference: https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks/manage-webhooks-notifications
 */
function verifyIntuitSignature(rawBody: string, signatureHeader: string | null, verifierToken: string): boolean {
  if (!signatureHeader) return false
  const expected = createHmac("sha256", verifierToken).update(rawBody, "utf8").digest("base64")
  try {
    const a = Buffer.from(signatureHeader)
    const b = Buffer.from(expected)
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export async function POST(request: NextRequest) {
  try {
    const expectedToken = process.env.PROCONNECT_WEBHOOK_VERIFIER_TOKEN

    // Read raw body once — we need it both for HMAC verification and JSON parsing.
    const rawBody = await request.text()

    // Verify webhook signature using HMAC-SHA256 of the raw body
    if (expectedToken) {
      const signature = request.headers.get("intuit-signature")
      if (!verifyIntuitSignature(rawBody, signature, expectedToken)) {
        console.warn("[ProConnect Webhook] Unauthorized — invalid HMAC signature")
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      }
    } else {
      console.warn("[ProConnect Webhook] PROCONNECT_WEBHOOK_VERIFIER_TOKEN not set — webhook is UNVERIFIED")
    }

    let payload: WebhookPayload
    try {
      payload = JSON.parse(rawBody) as WebhookPayload
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
    }

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
