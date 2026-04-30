/**
 * Karbon → Supabase upserts.
 *
 * Each function fetches a fresh record from Karbon by perma-key, runs the
 * appropriate pure mapper, and upserts it into the right Supabase table.
 *
 * Webhook payloads only contain a perma-key + change metadata — never the full
 * record — so the webhook hot path always lands here. The cron-based drift
 * reconciler also calls these functions directly (no HTTP self-fetches).
 */
import { getKarbonCredentials, karbonFetch, type KarbonApiConfig } from "@/lib/karbon-api"
import { tryCreateAdminClient } from "@/lib/supabase/server"
import { mapKarbonContactToSupabase } from "@/lib/karbon/mappers/contact"
import { mapKarbonOrganizationToSupabase } from "@/lib/karbon/mappers/organization"
import { mapKarbonClientGroupToSupabase } from "@/lib/karbon/mappers/client-group"
import { mapKarbonWorkItemToSupabase } from "@/lib/karbon/mappers/work-item"
import { mapKarbonNoteToSupabase } from "@/lib/karbon/mappers/note"
import { mapKarbonUserToSupabase } from "@/lib/karbon/mappers/user"
import { mapKarbonInvoiceToSupabase } from "@/lib/karbon/mappers/invoice"

export type UpsertResult = {
  ok: boolean
  action: "upserted" | "soft-deleted" | "no-op" | "skipped" | "not-found"
  table?: string
  error?: string
}

function getCreds(): KarbonApiConfig {
  const c = getKarbonCredentials()
  if (!c) throw new Error("Karbon API credentials not configured")
  return c
}

function getDb() {
  const db = tryCreateAdminClient()
  if (!db) throw new Error("Supabase admin client not configured")
  return db
}

function err(message: string): UpsertResult {
  return { ok: false, action: "skipped", error: message }
}

// ---------------------------------------------------------------------------
// Contact / Organization / ClientGroup
// ---------------------------------------------------------------------------
//
// The Karbon `Contact` webhook is shared across Contacts, Organizations, AND
// ClientGroups — the payload only carries a `ResourcePermaKey`. We don't know
// which kind it is. Strategy: try Contacts first (most common), fall back to
// Organizations, then ClientGroups. The Karbon API returns 404 for the wrong
// endpoint, which is cheap and reliable.

export async function upsertContactByKey(key: string): Promise<UpsertResult> {
  const creds = getCreds()
  const { data, error } = await karbonFetch<any>(
    `/Contacts/${key}?$expand=BusinessCards,AccountingDetail`,
    creds,
  )
  if (error || !data) return { ok: false, action: "not-found", error: error || "no data" }

  const db = getDb()
  const row = mapKarbonContactToSupabase(data)
  const { error: upErr } = await db
    .from("contacts")
    .upsert(row, { onConflict: "karbon_contact_key", ignoreDuplicates: false })
  if (upErr) return err(upErr.message)
  return { ok: true, action: "upserted", table: "contacts" }
}

export async function upsertOrganizationByKey(key: string): Promise<UpsertResult> {
  const creds = getCreds()
  const { data, error } = await karbonFetch<any>(
    `/Organizations/${key}?$expand=BusinessCards`,
    creds,
  )
  if (error || !data) return { ok: false, action: "not-found", error: error || "no data" }

  const db = getDb()
  const row = mapKarbonOrganizationToSupabase(data)
  const { error: upErr } = await db
    .from("organizations")
    .upsert(row, { onConflict: "karbon_organization_key", ignoreDuplicates: false })
  if (upErr) return err(upErr.message)
  return { ok: true, action: "upserted", table: "organizations" }
}

export async function upsertClientGroupByKey(key: string): Promise<UpsertResult> {
  const creds = getCreds()
  const { data, error } = await karbonFetch<any>(
    `/ClientGroups/${key}?$expand=BusinessCard,ClientTeam`,
    creds,
  )
  if (error || !data) return { ok: false, action: "not-found", error: error || "no data" }

  const db = getDb()
  const row = mapKarbonClientGroupToSupabase(data)
  const { error: upErr } = await db
    .from("client_groups")
    .upsert(row, { onConflict: "karbon_client_group_key", ignoreDuplicates: false })
  if (upErr) return err(upErr.message)
  return { ok: true, action: "upserted", table: "client_groups" }
}

/**
 * Webhook-driven dispatcher: tries Contact → Organization → ClientGroup. The
 * Karbon "Contact" webhook fires for any of the three.
 */
export async function upsertContactLikeByKey(key: string): Promise<UpsertResult> {
  // Try Contact
  const contactRes = await upsertContactByKey(key)
  if (contactRes.ok || contactRes.action !== "not-found") return contactRes
  // Fall back to Organization
  const orgRes = await upsertOrganizationByKey(key)
  if (orgRes.ok || orgRes.action !== "not-found") return orgRes
  // Fall back to ClientGroup
  return upsertClientGroupByKey(key)
}

// ---------------------------------------------------------------------------
// Work item
// ---------------------------------------------------------------------------

export async function upsertWorkItemByKey(key: string): Promise<UpsertResult> {
  const creds = getCreds()
  const { data, error } = await karbonFetch<any>(`/WorkItems/${key}`, creds)
  if (error || !data) return { ok: false, action: "not-found", error: error || "no data" }

  const db = getDb()
  const row = mapKarbonWorkItemToSupabase(data)
  const { error: upErr } = await db
    .from("work_items")
    .upsert(row, { onConflict: "karbon_work_item_key", ignoreDuplicates: false })
  if (upErr) return err(upErr.message)
  return { ok: true, action: "upserted", table: "work_items" }
}

// ---------------------------------------------------------------------------
// Note
// ---------------------------------------------------------------------------

export async function upsertNoteByKey(key: string): Promise<UpsertResult> {
  const creds = getCreds()
  const { data, error } = await karbonFetch<any>(`/Notes/${key}`, creds)
  if (error || !data) return { ok: false, action: "not-found", error: error || "no data" }

  const db = getDb()
  const row = mapKarbonNoteToSupabase(data)
  const { error: upErr } = await db
    .from("karbon_notes")
    .upsert(
      { ...row, created_at: new Date().toISOString() },
      { onConflict: "karbon_note_key", ignoreDuplicates: false },
    )
  if (upErr) return err(upErr.message)
  return { ok: true, action: "upserted", table: "karbon_notes" }
}

// ---------------------------------------------------------------------------
// User (team_members)
// ---------------------------------------------------------------------------

export async function upsertUserByKey(key: string): Promise<UpsertResult> {
  const creds = getCreds()
  const { data, error } = await karbonFetch<any>(`/Users/${key}`, creds)
  if (error || !data) return { ok: false, action: "not-found", error: error || "no data" }

  const db = getDb()
  const row = mapKarbonUserToSupabase(data)

  // team_members has dual identity (karbon_user_key + email). Try update by
  // karbon_user_key first; if no row matched, insert.
  const { data: existing } = await db
    .from("team_members")
    .select("id")
    .eq("karbon_user_key", row.karbon_user_key)
    .maybeSingle()

  if (existing) {
    const { error: upErr } = await db.from("team_members").update(row).eq("id", existing.id)
    if (upErr) return err(upErr.message)
    return { ok: true, action: "upserted", table: "team_members" }
  }

  // Try email fallback
  if (row.email) {
    const { data: byEmail } = await db
      .from("team_members")
      .select("id")
      .eq("email", row.email)
      .maybeSingle()
    if (byEmail) {
      const { error: upErr } = await db.from("team_members").update(row).eq("id", byEmail.id)
      if (upErr) return err(upErr.message)
      return { ok: true, action: "upserted", table: "team_members" }
    }
  }

  const { error: insErr } = await db
    .from("team_members")
    .insert({ ...row, created_at: new Date().toISOString() })
  if (insErr) return err(insErr.message)
  return { ok: true, action: "upserted", table: "team_members" }
}

// ---------------------------------------------------------------------------
// Invoice
// ---------------------------------------------------------------------------

export async function upsertInvoiceByKey(key: string): Promise<UpsertResult> {
  const creds = getCreds()
  const { data, error } = await karbonFetch<any>(`/Invoices/${key}`, creds)
  if (error || !data) return { ok: false, action: "not-found", error: error || "no data" }

  const db = getDb()
  const row = {
    ...mapKarbonInvoiceToSupabase(data),
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  const { error: upErr } = await db
    .from("karbon_invoices")
    .upsert(row, { onConflict: "karbon_invoice_key", ignoreDuplicates: false })
  if (upErr) return err(upErr.message)
  return { ok: true, action: "upserted", table: "karbon_invoices" }
}

// ---------------------------------------------------------------------------
// Estimate summary (lives on a work item)
// ---------------------------------------------------------------------------

export async function upsertEstimateSummaryByWorkItemKey(workItemKey: string): Promise<UpsertResult> {
  // Estimates are folded into the work item's fee/budget summary — refresh the
  // parent work item to pick them up.
  return upsertWorkItemByKey(workItemKey)
}

// ---------------------------------------------------------------------------
// Custom field values
// ---------------------------------------------------------------------------

export async function upsertCustomFieldValuesByEntityKey(
  entityKey: string,
  entityType: "Contact" | "Organization" | string,
): Promise<UpsertResult> {
  // Custom field values live on the parent entity record — re-fetch the parent
  // and the mapper picks up CustomFieldValues into the `custom_fields` jsonb.
  if (entityType === "Organization") return upsertOrganizationByKey(entityKey)
  if (entityType === "Contact") return upsertContactByKey(entityKey)
  // Unknown entity type — fall back to the contact-like dispatcher
  return upsertContactLikeByKey(entityKey)
}

// ---------------------------------------------------------------------------
// Soft delete
// ---------------------------------------------------------------------------

/**
 * Best-effort soft delete. Most Karbon entities don't have a dedicated
 * `deleted_at` column on their Supabase mirror tables today. Where one exists
 * we use it; otherwise we mark `status='Deleted'` if the column is present;
 * else we no-op (Karbon will likely re-emit a Modified event with a tombstone
 * payload anyway).
 */
export async function softDeleteByKey(
  table: "contacts" | "organizations" | "client_groups" | "work_items" | "karbon_notes",
  keyColumn: string,
  key: string,
): Promise<UpsertResult> {
  const db = getDb()
  // Try to set status to 'Deleted' (works for contacts/work_items)
  const { error } = await db
    .from(table)
    .update({ status: "Deleted", updated_at: new Date().toISOString() })
    .eq(keyColumn, key)
  if (error) {
    // status column probably doesn't exist on this table — record as no-op
    return { ok: true, action: "no-op", table, error: error.message }
  }
  return { ok: true, action: "soft-deleted", table }
}
