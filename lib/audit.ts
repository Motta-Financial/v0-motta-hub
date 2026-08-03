/**
 * Audit trail helper.
 *
 * Records field-level changes to the shared `activity_log` table for the
 * Hub's core editable entities (contacts, organizations, deals, projects).
 *
 * Usage from any PATCH/POST/DELETE handler:
 *
 *   await recordAudit({
 *     entityType: "deal",
 *     entityId: id,
 *     teamMemberId,            // resolved from the session, may be null
 *     action: "update",
 *     oldRecord,               // row BEFORE the update
 *     newRecord,               // row AFTER the update
 *   })
 *
 * The helper computes a diff of `oldRecord` vs `newRecord`, stores it as
 * `{ field: { from, to } }` in the `changes` jsonb column, and writes a
 * short human-readable `description`. It NEVER throws — auditing must never
 * break the primary write — and logs failures with a "[v0]" prefix instead.
 */

import { createAdminClient } from "@/lib/supabase/server"

export type AuditEntityType = "contact" | "organization" | "deal" | "project"
export type AuditAction = "create" | "update" | "delete"

type Row = Record<string, unknown> | null | undefined

interface RecordAuditArgs {
  entityType: AuditEntityType
  entityId: string
  teamMemberId: string | null
  action: AuditAction
  oldRecord?: Row
  newRecord?: Row
  /** Optional extra context stored verbatim in the metadata column. */
  metadata?: Record<string, unknown>
}

/**
 * Columns that are noise for an audit trail — bookkeeping timestamps,
 * derived/search columns, large raw blobs. Changes to these are ignored
 * when computing the diff.
 */
const IGNORED_FIELDS = new Set<string>([
  "updated_at",
  "created_at",
  "last_synced_at",
  "karbon_created_at",
  "karbon_modified_at",
  "search_vector",
  "raw_data",
  "raw_payload",
  "raw_json",
  "custom_fields",
  "business_cards",
  "accounting_detail",
  "assigned_team_members",
])

/** Human labels for the most commonly edited fields. */
const FIELD_LABELS: Record<string, string> = {
  first_name: "first name",
  last_name: "last name",
  preferred_name: "preferred name",
  primary_email: "email",
  secondary_email: "secondary email",
  phone_primary: "phone",
  phone_mobile: "mobile phone",
  phone_work: "work phone",
  address_line1: "address",
  address_line2: "address line 2",
  zip_code: "ZIP code",
  contact_preference: "contact preference",
  linkedin_url: "LinkedIn",
  twitter_handle: "Twitter",
  estimated_value: "estimated value",
  owner_team_member_id: "owner",
  project_type_key: "project type",
  project_template_key: "project template",
  work_type_pattern: "work type pattern",
  work_template_pattern: "work template pattern",
  start_date: "start date",
  end_date: "end date",
  fiscal_year_end_month: "fiscal year end month",
  incorporation_state: "incorporation state",
  trading_name: "trading name",
  entity_type: "entity type",
  line_of_business: "line of business",
}

function labelFor(field: string): string {
  return FIELD_LABELS[field] || field.replace(/_/g, " ")
}

/** Stable comparison that treats null/undefined/"" as equal and arrays/objects by JSON. */
function valuesEqual(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (v === undefined || v === null || v === "" ? null : v)
  const na = norm(a)
  const nb = norm(b)
  if (na === nb) return true
  if (na === null || nb === null) return false
  if (typeof na === "object" || typeof nb === "object") {
    try {
      return JSON.stringify(na) === JSON.stringify(nb)
    } catch {
      return false
    }
  }
  return false
}

/** Compute a `{ field: { from, to } }` diff between two rows. */
function computeDiff(
  oldRecord: Row,
  newRecord: Row,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  const oldR = oldRecord || {}
  const newR = newRecord || {}
  const keys = new Set([...Object.keys(oldR), ...Object.keys(newR)])
  for (const key of keys) {
    if (IGNORED_FIELDS.has(key)) continue
    const from = (oldR as Record<string, unknown>)[key]
    const to = (newR as Record<string, unknown>)[key]
    if (!valuesEqual(from, to)) {
      changes[key] = { from: from ?? null, to: to ?? null }
    }
  }
  return changes
}

const ENTITY_LABELS: Record<AuditEntityType, string> = {
  contact: "contact",
  organization: "organization",
  deal: "deal",
  project: "project",
}

function buildDescription(
  entityType: AuditEntityType,
  action: AuditAction,
  changedFields: string[],
): string {
  const noun = ENTITY_LABELS[entityType]
  if (action === "create") return `Created ${noun}`
  if (action === "delete") return `Deleted ${noun}`
  if (changedFields.length === 0) return `Updated ${noun}`
  const labels = changedFields.map(labelFor)
  if (labels.length === 1) return `Updated ${noun} ${labels[0]}`
  if (labels.length === 2) return `Updated ${noun} ${labels[0]} and ${labels[1]}`
  const head = labels.slice(0, 2).join(", ")
  return `Updated ${noun} ${head} and ${labels.length - 2} more`
}

export async function recordAudit({
  entityType,
  entityId,
  teamMemberId,
  action,
  oldRecord,
  newRecord,
  metadata,
}: RecordAuditArgs): Promise<void> {
  try {
    const changes = action === "delete" ? {} : computeDiff(oldRecord, newRecord)
    const changedFields = Object.keys(changes)

    // Nothing actually changed on an update — skip writing a noise entry.
    if (action === "update" && changedFields.length === 0) return

    const supabase = createAdminClient()
    const { error } = await supabase.from("activity_log").insert({
      entity_type: entityType,
      entity_id: entityId,
      team_member_id: teamMemberId,
      action,
      description: buildDescription(entityType, action, changedFields),
      changes,
      metadata: metadata ?? null,
    })

    if (error) {
      console.error("[v0] recordAudit insert error:", error.message)
    }
  } catch (err) {
    console.error("[v0] recordAudit unexpected error:", err)
  }
}
