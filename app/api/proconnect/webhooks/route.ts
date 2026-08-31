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
 * Webhook verification uses the PROCONNECT_WEBHOOK_VERIFIER_TOKEN env var
 * and is mandatory: if the token is absent on the serving deployment, the
 * route rejects every request with 503 rather than processing unverified
 * webhooks. See maybeSendVerifierMissingAlert below.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createHmac, timingSafeEqual } from "node:crypto"
import {
  syncSingleClient,
  prefetchClientList,
  hydrateEngagementEfile,
  deleteClient,
  refreshCustomStatuses,
} from "@/lib/proconnect/sync"
import { exportReturnData } from "@/lib/proconnect/data"
import { persistReturnSnapshot } from "@/lib/proconnect/snapshots"
import { scanRelationships } from "@/lib/tax/relationships/scanner"

const SUPABASE_URL = (process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL)!
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
  status: "processed" | "failed" | "skipped",
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
 * Process a Client event.
 *
 * ProConnect has no single-client GET, so Create/Update events resolve
 * against the full /v1/clients list. `sharedClientList` is fetched at
 * most once per webhook delivery (Intuit batches many entities into one
 * POST) — fetching it per-entity is what produced the 429 storms.
 */
async function processClientEvent(
  entity: WebhookEntity,
  sharedClientList: unknown[] | null
): Promise<{ success: boolean; skipped?: boolean; error?: string }> {
  if (entity.operation === "Delete") {
    return deleteClient(entity.id)
  }

  // Create or Update - fetch fresh data
  return syncSingleClient(entity.id, sharedClientList)
}

/**
 * Re-read one engagement's e-file status from the single-engagement GET.
 *
 * Always non-fatal. A failure here costs at most one webhook's worth of
 * freshness: the engagement stays in the stale set (efile_synced_at is only
 * stamped on success) and the nightly hydration pass retries it. Failing the
 * webhook instead would make Intuit redeliver the whole batch, re-running the
 * export and relationship scan alongside it.
 *
 * missingRow is expected, not an error — a Create event can beat the
 * engagement list sync that creates the row.
 */
async function refreshEfileStatus(engagementId: string): Promise<void> {
  try {
    const result = await hydrateEngagementEfile(engagementId)
    if (result.ok) {
      console.log(
        `[ProConnect Webhook] e-file status for ${engagementId}: ${result.status ?? "(no filings)"}`
      )
    } else if (result.missingRow) {
      console.log(
        `[ProConnect Webhook] e-file hydrate skipped for ${engagementId}: engagement row not synced yet`
      )
    } else if (result.notFound) {
      // Normal on a Delete event, and on an Update that races a deletion.
      console.log(
        `[ProConnect Webhook] e-file hydrate skipped for ${engagementId}: no longer in ProConnect`
      )
    } else {
      console.warn(
        `[ProConnect Webhook] e-file hydrate failed for ${engagementId}: ${result.error}`
      )
    }
  } catch (err) {
    console.warn(
      "[ProConnect Webhook] e-file hydrate threw (non-fatal):",
      err instanceof Error ? err.message : err
    )
  }
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

  // Create / Update: pull e-file status first. This is the only path that
  // gets it in near-real time — the nightly sync's list endpoint carries no
  // filings, so its hydration step is a capped catch-up queue. During filing
  // season the acceptance/rejection a preparer is waiting on arrives here.
  // Deliberately ahead of the export below: an export failure returns early,
  // and e-file status shouldn't be collateral damage of a 403 on a different
  // service.
  await refreshEfileStatus(entity.id)

  // Refresh the snapshot. Export failures must not
  // 4xx/5xx the webhook response (Intuit would retry the whole batch),
  // but they DO mark the event row failed — the old warn-and-return-
  // success pattern hid months of scope_missing 403s behind "processed"
  // statuses and left every Phase 1 table empty with no signal anywhere.
  try {
    const result = await exportReturnData(clientId, entity.id)
    if (!result.ok) {
      console.warn(
        `[ProConnect Webhook] TaxReturn ${entity.id} export failed: ${result.error.kind} ${result.error.status}`
      )
      // Config-shaped failures (missing scope / app not allow-listed)
      // additionally raise a throttled email — they never self-heal.
      if (result.error.kind === "scope_missing" || result.error.kind === "access_denied") {
        try {
          await maybeSendPhase1ExportAlert(sb, result.error.kind, result.error.status)
        } catch (alertErr) {
          console.error(
            "[ProConnect Webhook] phase1 export alert failed:",
            alertErr instanceof Error ? alertErr.message : alertErr
          )
        }
      }
      // Capture Intuit's own response body alongside our classification.
      // `scope_missing` is OUR label for an unattributed 403 (one whose
      // errorCode is neither RETURN_LOCKED nor ACCESS_DENIED) — when
      // raising a provisioning ticket, Intuit needs THEIR errorCode and
      // the intuit-tid, not our inference. Truncated to 500 chars.
      // PII-safe: Phase 1 error bodies carry {errorCode, errorMessage}
      // only, and Intuit never echoes a failing SSN/EIN/TIN.
      const upstream = result.error.body ? ` upstream=${result.error.body.slice(0, 500)}` : ""
      return {
        success: false,
        error: `export failed: ${result.error.kind} ${result.error.status}${result.intuitTid ? ` (intuit-tid ${result.intuitTid})` : ""}${upstream}`,
      }
    }
    await persistReturnSnapshot(sb, clientId, entity.id, result.data)
    // Re-scan relationships against the freshly imported snapshot so
    // newly visible K-1 issuers / Schedule-E payers / business owners
    // surface in the review queue without waiting for the next cron.
    // We scope to this engagement only — full sweeps stay on the
    // nightly cadence so a chatty webhook day can't DOS the scorer.
    try {
      await scanRelationships(sb, { kind: "engagement", engagementId: entity.id })
    } catch (relErr) {
      console.warn(
        "[ProConnect Webhook] relationship rescan failed (non-fatal):",
        relErr instanceof Error ? relErr.message : relErr,
      )
    }

    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Email a throttled alert when Phase 1 return-data exports are blocked
 * by a configuration problem (missing scope / app not allow-listed by
 * Intuit). Deduped to ~once per day via the integration_alerts table —
 * same pattern as the Karbon auth alert in the karbon-sync cron.
 */
const PHASE1_ALERT_KEY = "proconnect_phase1_export"
const PHASE1_ALERT_MIN_INTERVAL_MS = 20 * 60 * 60 * 1000
const PHASE1_ALERT_RECIPIENTS = ["team@motta.co"]

async function maybeSendPhase1ExportAlert(
  sb: ReturnType<typeof getSupabaseAdmin>,
  kind: string,
  status: number
): Promise<void> {
  const { data: prior } = await sb
    .from("integration_alerts")
    .select("last_alert_at")
    .eq("integration", PHASE1_ALERT_KEY)
    .maybeSingle()

  if (
    prior?.last_alert_at &&
    Date.now() - new Date(prior.last_alert_at).getTime() < PHASE1_ALERT_MIN_INTERVAL_MS
  ) {
    return
  }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.error(
      "[ProConnect Webhook] Phase 1 exports are blocked but RESEND_API_KEY is unset — cannot alert"
    )
    return
  }

  const { Resend } = await import("resend")
  const resend = new Resend(apiKey)
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || "noreply@motta.co",
    to: PHASE1_ALERT_RECIPIENTS,
    subject: "[Motta Hub] ProConnect return-data exports are blocked",
    html: `
      <h2>ProConnect Phase 1 export is failing (${kind}, HTTP ${status})</h2>
      <p>Tax-return webhooks are arriving, but every attempt to export the
      return's field data from <code>api.intuit.com</code> is rejected. Until
      this is resolved, <code>proconnect_return_snapshots</code> stays stale/empty
      and the return-data viewer and import (write-back) features cannot work.</p>
      <h3>What to check, in order</h3>
      ${
        kind === "scope_missing"
          ? `<p><strong>Do not open a ticket with Intuit first.</strong> <code>scope_missing</code> is
      this app's label for any 401 and for any 403 whose errorCode is neither
      RETURN_LOCKED nor ACCESS_DENIED — it does not prove anything about
      allow-listing. Check in this order:</p>
      <ol>
        <li><strong>Which commit is production serving?</strong> On 2026-08-15 a promoted
        preview reverted the Export path to <code>/v2/clients/{id}/returns/{id}/data</code>
        (no <code>oii-client/</code> segment), which 403s on every call. Production must be
        serving <code>main</code>; a deployment whose meta shows <code>action: "promote"</code>
        and a <code>githubCommitRef</code> other than <code>main</code> is the bug.</li>
        <li><strong>Token health</strong> — <code>proconnect_oauth_tokens</code>:
        <code>expires_at</code> in the future and <code>last_refresh_error</code> null.</li>
        <li><strong>Only then</strong> allow-listing: contact the Intuit ProConnect API
        partner team (realm 9130356180193146) and give them their own errorCode and
        intuit-tid from the logs, not this classification.</li>
      </ol>`
          : `<p><strong>The token's firm does not have access to this return.</strong>
      Review the client/return ownership for this engagement.</p>`
      }
      <p>Details: docs/proconnect-integration-review.md · This alert repeats at most once per day while the failure persists.</p>
    `,
  })

  await sb.from("integration_alerts").upsert(
    {
      integration: PHASE1_ALERT_KEY,
      last_alert_at: new Date().toISOString(),
      last_alert_reason: `Phase 1 export ${kind} (HTTP ${status})`,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "integration" }
  )
  console.log("[ProConnect Webhook] Phase 1 export alert sent to", PHASE1_ALERT_RECIPIENTS.join(", "))
}

/**
 * Email a throttled alert when incoming ProConnect webhooks are being
 * rejected because PROCONNECT_WEBHOOK_VERIFIER_TOKEN is unset on the
 * serving deployment. Deduped to ~once per day via the integration_alerts
 * table — same pattern as maybeSendPhase1ExportAlert above.
 */
const VERIFIER_ALERT_KEY = "proconnect_webhook_verifier"
const VERIFIER_ALERT_MIN_INTERVAL_MS = 20 * 60 * 60 * 1000

async function maybeSendVerifierMissingAlert(
  sb: ReturnType<typeof getSupabaseAdmin>
): Promise<void> {
  const { data: prior } = await sb
    .from("integration_alerts")
    .select("last_alert_at")
    .eq("integration", VERIFIER_ALERT_KEY)
    .maybeSingle()

  if (
    prior?.last_alert_at &&
    Date.now() - new Date(prior.last_alert_at).getTime() < VERIFIER_ALERT_MIN_INTERVAL_MS
  ) {
    return
  }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.error(
      "[ProConnect Webhook] Webhooks are being rejected but RESEND_API_KEY is unset — cannot alert"
    )
    return
  }

  const { Resend } = await import("resend")
  const resend = new Resend(apiKey)
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || "noreply@motta.co",
    to: PHASE1_ALERT_RECIPIENTS,
    subject: "[Motta Hub] ProConnect webhooks are being rejected — verifier token missing",
    html: `
      <h2>ProConnect webhook verification is not configured</h2>
      <p><code>PROCONNECT_WEBHOOK_VERIFIER_TOKEN</code> is unset on the
      serving deployment. Every incoming ProConnect webhook is now being
      rejected with HTTP 503, so <code>Client</code> and <code>TaxReturn</code>
      data will go stale until it is set.</p>
      <p>Set <code>PROCONNECT_WEBHOOK_VERIFIER_TOKEN</code> on the
      <strong>mottahub</strong> Vercel project. In the meantime, the nightly
      sync (<code>/api/cron/proconnect-sync</code>) is the fallback and will
      keep data from drifting too far.</p>
      <p>This alert repeats at most once per day while the token remains unset.</p>
    `,
  })

  await sb.from("integration_alerts").upsert(
    {
      integration: VERIFIER_ALERT_KEY,
      last_alert_at: new Date().toISOString(),
      last_alert_reason: "PROCONNECT_WEBHOOK_VERIFIER_TOKEN unset — webhooks rejected with 503",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "integration" }
  )
  console.log("[ProConnect Webhook] Verifier-missing alert sent to", PHASE1_ALERT_RECIPIENTS.join(", "))
}

/**
 * Process a TaxReturnWorkStatus event.
 *
 * ─── WHAT THIS EVENT ACTUALLY IS ────────────────────────────────────
 * Intuit PD confirmed on 2026-08-24, via Steve: the event is published
 * "only with the custom status LIST changes." It fires when the firm edits
 * its catalog of statuses — adds one, renames one, removes one — NOT when
 * an individual return moves from "In progress" to "E-Filed".
 *
 * The name reads as per-return work status and we built for that: this
 * handler used to treat entity.id as an engagement UUID and look it up in
 * proconnect_engagements. That lookup could never match, because the id is
 * a status id. It would log "not yet in engagements", soft-succeed, and do
 * nothing — so even the events we spent months waiting for would have been
 * silently discarded on arrival.
 *
 * Zero have been delivered across 6,025 events, which is consistent: the
 * firm's 40-status catalog has been stable. 702 of 923 engagements carry a
 * custom status and those change constantly, but that is not what this
 * event reports.
 *
 * ─── CONSEQUENCE ────────────────────────────────────────────────────
 * There is NO real-time notification of a return's status changing. The
 * nightly sync is the only path, permanently. Do not add a "waiting for
 * the webhook" caveat to that anywhere — it is not coming.
 */
async function processTaxReturnWorkStatusEvent(
  entity: WebhookEntity
): Promise<{ success: boolean; error?: string }> {
  console.log(
    `[ProConnect Webhook] TaxReturnWorkStatus ${entity.operation} (${entity.id}) — ` +
      "custom status LIST changed; re-syncing the catalog"
  )

  const result = await refreshCustomStatuses()
  if (result.errors.length > 0) {
    // Soft-fail: the nightly sync re-reads the catalog anyway.
    console.warn(
      `[ProConnect Webhook] custom status re-sync had errors: ${result.errors.join("; ")}`
    )
  }
  return { success: true }
}

/**
 * Process a single webhook entity
 */
async function processEntity(
  entity: WebhookEntity,
  realmId: string,
  payload: unknown,
  sharedClientList: unknown[] | null
): Promise<void> {
  const eventId = await logWebhookEvent(entity, realmId, payload, "pending")

  try {
    let result: { success: boolean; skipped?: boolean; error?: string }

    switch (entity.name) {
      case "Client":
        result = await processClientEvent(entity, sharedClientList)
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

    // skipped = received but intentionally not applied (e.g. an event for a
    // client/return that's no longer in ProConnect). Not a fault — kept
    // distinct from "failed" so the status panel doesn't cry wolf.
    if (result.skipped) {
      await updateWebhookEvent(eventId, "skipped", result.error)
    } else if (result.success) {
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
      console.error(
        "[ProConnect Webhook] PROCONNECT_WEBHOOK_VERIFIER_TOKEN is not set — rejecting webhook. Set it on the mottahub Vercel project."
      )
      try {
        await maybeSendVerifierMissingAlert(getSupabaseAdmin())
      } catch (alertErr) {
        console.error(
          "[ProConnect Webhook] verifier-missing alert failed:",
          alertErr instanceof Error ? alertErr.message : alertErr
        )
      }
      return NextResponse.json(
        { error: "Webhook verification not configured" },
        { status: 503 }
      )
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

    // Fetch the client list at most once per delivery — Client
    // Create/Update events resolve against it (no single-client GET),
    // and per-entity fetches are what rate-limited us in the past.
    const needsClientList = payload.eventNotifications.some((n) =>
      (n.dataChangeEvent?.entities || []).some(
        (e) => e.name === "Client" && e.operation !== "Delete"
      )
    )
    const sharedClientList = needsClientList ? await prefetchClientList() : null

    // Process each notification
    const results: Array<{ entity: string; success: boolean; error?: string }> = []

    for (const notification of payload.eventNotifications) {
      const realmId = notification.realmId
      const entities = notification.dataChangeEvent?.entities || []

      for (const entity of entities) {
        await processEntity(entity, realmId, payload, sharedClientList)
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
