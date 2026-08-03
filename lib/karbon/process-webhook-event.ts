/**
 * Webhook event processor.
 *
 * Pure dispatcher: takes a row from `karbon_webhook_events`, figures out which
 * upsert function to call, and updates the event row's processing_status.
 *
 * Called from:
 *   - the inbound webhook receiver (via waitUntil)
 *   - the cron replay worker (for pending/failed rows)
 *   - the admin UI's "retry" button
 */
import { tryCreateAdminClient } from "@/lib/supabase/server"
import { getKarbonCredentials, karbonFetch } from "@/lib/karbon-api"
import {
  upsertContactLikeByKey,
  upsertWorkItemByKey,
  upsertNoteByKey,
  upsertUserByKey,
  upsertInvoiceByKey,
  upsertEstimateSummaryByWorkItemKey,
  upsertCustomFieldValuesByEntityKey,
  softDeleteByKey,
  type UpsertResult,
} from "@/lib/karbon/upsert"

export interface WebhookEventRow {
  id: string
  resource_type: string
  action_type: string
  resource_perma_key: string
  parent_entity_key: string | null
  client_key: string | null
  client_type: string | null
  retry_count: number
}

/**
 * Process a single webhook event. Updates the row's processing_status and
 * returns the result. Safe to call multiple times for the same event.
 */
export async function processWebhookEvent(event: WebhookEventRow): Promise<UpsertResult> {
  const db = tryCreateAdminClient()
  if (!db) {
    return { ok: false, action: "skipped", error: "Supabase admin client not configured" }
  }

  // Mark as processing (advisory — guards against concurrent retries)
  await db
    .from("karbon_webhook_events")
    .update({ processing_status: "processing" })
    .eq("id", event.id)

  let result: UpsertResult
  try {
    result = await dispatch(event)
  } catch (e: any) {
    result = { ok: false, action: "skipped", error: e?.message || String(e) }
  }

  // Persist outcome
  const status = result.ok
    ? result.action === "no-op"
      ? "skipped"
      : "succeeded"
    : "failed"

  await db
    .from("karbon_webhook_events")
    .update({
      processing_status: status,
      processed_at: new Date().toISOString(),
      processing_error: result.error || null,
      retry_count: status === "failed" ? event.retry_count + 1 : event.retry_count,
    })
    .eq("id", event.id)

  return result
}

async function dispatch(event: WebhookEventRow): Promise<UpsertResult> {
  const { resource_type: resourceType, action_type: actionType, resource_perma_key: key } = event

  // -------------------------------------------------------------------------
  // Deletions: confirm with Karbon (a GET returning 404) before soft-deleting.
  // Webhook payloads are just key + metadata, so a forged or stale Deleted
  // event would otherwise soft-delete live rows without any Karbon round-trip.
  // -------------------------------------------------------------------------
  if (actionType === "Deleted") {
    const endpoints = deletedVerificationEndpoints(resourceType, key)
    if (endpoints.length > 0) {
      const verdict = await confirmGoneInKarbon(endpoints)
      if (verdict === "exists") {
        return {
          ok: false,
          action: "skipped",
          error: `Deleted event for ${resourceType} ${key}, but the entity still exists in Karbon — refusing soft-delete`,
        }
      }
      if (verdict === "unknown") {
        // Couldn't reach Karbon (or creds missing) — fail the event so the
        // replay cron retries instead of deleting on an unverified claim.
        return {
          ok: false,
          action: "skipped",
          error: `Could not verify deletion of ${resourceType} ${key} against Karbon — will retry`,
        }
      }
    }
    if (resourceType === "Contact" || resourceType === "Organization" || resourceType === "ClientGroup") {
      // Try all three contact-like tables
      const r1 = await softDeleteByKey("contacts", "karbon_contact_key", key)
      const r2 = await softDeleteByKey("organizations", "karbon_organization_key", key)
      const r3 = await softDeleteByKey("client_groups", "karbon_client_group_key", key)
      return r1.ok ? r1 : r2.ok ? r2 : r3
    }
    if (resourceType === "Work" || resourceType === "WorkItem")
      return softDeleteByKey("work_items", "karbon_work_item_key", key)
    if (resourceType === "Note" || resourceType === "NoteComment")
      return softDeleteByKey("karbon_notes", "karbon_note_key", key)
    return { ok: true, action: "no-op", error: `No soft-delete path for ${resourceType}` }
  }

  // -------------------------------------------------------------------------
  // Inserted / Modified — fetch fresh from Karbon and upsert
  // -------------------------------------------------------------------------
  switch (resourceType) {
    case "Contact":
    case "Organization":
    case "ClientGroup":
      // Karbon's contact-family webhooks fire for Contacts, Organizations, and
      // ClientGroups. Live payloads carry the specific type name (we've seen
      // "Organization" and "ClientGroup" on the wire, not just "Contact"), and
      // the upsert helper tries each table in turn regardless.
      return upsertContactLikeByKey(key)

    case "Work":
    case "WorkItem":
      // The docs say "Work" but live payloads send "WorkItem" — accept both.
      return upsertWorkItemByKey(key)

    case "Note":
      return upsertNoteByKey(key)

    case "NoteComment": {
      // The webhook key is the comment key, but our model is per-note. The
      // ParentEntityKey is the parent Note key — refresh that.
      const noteKey = event.parent_entity_key || key
      return upsertNoteByKey(noteKey)
    }

    case "User":
      return upsertUserByKey(key)

    case "IntegrationTask": {
      // Per the spec, IntegrationTask payloads carry a ClientKey identifying
      // the parent work item. Refresh the parent work item to pick up the
      // updated todo counts.
      const workItemKey = event.client_key || key
      return upsertWorkItemByKey(workItemKey)
    }

    case "Invoice":
      return upsertInvoiceByKey(key)

    case "Estimate":
    case "EstimateSummary":
      return upsertEstimateSummaryByWorkItemKey(key)

    case "CustomFieldValue":
    case "CustomField": {
      const entityKey = event.client_key || key
      const entityType = event.client_type || "Contact"
      return upsertCustomFieldValuesByEntityKey(entityKey, entityType)
    }

    default:
      // ok:false so the event lands in processing_status='failed' and is
      // visible on the dashboard / picked up by "Retry failed". Previously this
      // returned ok:true, which marked dropped events as "succeeded" — that hid
      // months of WorkItem events being silently discarded.
      return { ok: false, action: "skipped", error: `Unknown resource type: ${resourceType}` }
  }
}

/**
 * Karbon GET endpoints that must ALL 404 before we trust a Deleted event.
 * Contact-family webhooks don't say which of the three kinds the key is, so
 * all three endpoints are checked.
 */
function deletedVerificationEndpoints(resourceType: string, key: string): string[] {
  switch (resourceType) {
    case "Contact":
    case "Organization":
    case "ClientGroup":
      return [`/Contacts/${key}`, `/Organizations/${key}`, `/ClientGroups/${key}`]
    case "Work":
    case "WorkItem":
      return [`/WorkItems/${key}`]
    case "Note":
    case "NoteComment":
      return [`/Notes/${key}`]
    default:
      return []
  }
}

async function confirmGoneInKarbon(endpoints: string[]): Promise<"gone" | "exists" | "unknown"> {
  const creds = getKarbonCredentials()
  if (!creds) return "unknown"

  let sawTransientError = false
  for (const endpoint of endpoints) {
    const { data, error } = await karbonFetch<any>(endpoint, creds)
    if (data) return "exists"
    // karbonFetch formats errors as "<status>: <statusText> — <body>"
    if (error && !error.startsWith("404")) sawTransientError = true
  }
  return sawTransientError ? "unknown" : "gone"
}
