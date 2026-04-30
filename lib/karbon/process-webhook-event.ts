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
  // Deletions: soft-delete the row and stop. Karbon may have already removed
  // the record so we can't refetch.
  // -------------------------------------------------------------------------
  if (actionType === "Deleted") {
    if (resourceType === "Contact") {
      // Try all three contact-like tables
      const r1 = await softDeleteByKey("contacts", "karbon_contact_key", key)
      const r2 = await softDeleteByKey("organizations", "karbon_organization_key", key)
      const r3 = await softDeleteByKey("client_groups", "karbon_client_group_key", key)
      return r1.ok ? r1 : r2.ok ? r2 : r3
    }
    if (resourceType === "Work") return softDeleteByKey("work_items", "karbon_work_item_key", key)
    if (resourceType === "Note" || resourceType === "NoteComment")
      return softDeleteByKey("karbon_notes", "karbon_note_key", key)
    return { ok: true, action: "no-op", error: `No soft-delete path for ${resourceType}` }
  }

  // -------------------------------------------------------------------------
  // Inserted / Modified — fetch fresh from Karbon and upsert
  // -------------------------------------------------------------------------
  switch (resourceType) {
    case "Contact":
      // Karbon's "Contact" webhook fires for Contacts, Organizations, and
      // ClientGroups — the dispatcher tries each in turn.
      return upsertContactLikeByKey(key)

    case "Work":
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
      return { ok: true, action: "skipped", error: `Unknown resource type: ${resourceType}` }
  }
}
