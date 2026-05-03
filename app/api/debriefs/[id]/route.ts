import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient, createClient } from "@/lib/supabase/server"

/**
 * PATCH /api/debriefs/[id]
 * ────────────────────────────────────────────────────────────────────────
 * Allow signed-in users to clean up an existing debrief — most importantly
 * the client mapping (organization_id / contact_id) but also type, status,
 * notes, follow-up date, and the linked Karbon work item URL.
 *
 * The endpoint requires a valid Supabase session. It uses the admin client
 * for the actual write so it can bypass row-level security and refresh the
 * denormalized `organization_name` + `karbon_client_key` columns from the
 * canonical `organizations` / `contacts` rows.
 */

// Whitelist of fields the user is allowed to edit. Anything else in the
// request body is silently dropped — keeps the surface area tight and
// prevents accidental writes to internal columns (created_at, action_items
// JSON, etc.).
const ALLOWED_FIELDS = new Set([
  "organization_id",
  "contact_id",
  "work_item_id",
  "debrief_type",
  "status",
  "notes",
  "tax_year",
  "follow_up_date",
  "karbon_work_url",
])

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing debrief id" }, { status: 400 })
  }

  // Auth gate: we don't enforce role-based permissions, but we do require a
  // logged-in session so anonymous traffic can't mutate records.
  try {
    const auth = await createClient()
    const {
      data: { user },
    } = await auth.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  let body: Record<string, any>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  // Pluck only the whitelisted fields out of the body.
  const updates: Record<string, any> = {}
  for (const k of Object.keys(body)) {
    if (ALLOWED_FIELDS.has(k)) updates[k] = body[k]
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No editable fields supplied" }, { status: 400 })
  }

  // Coerce empty strings to null so optional FK / text fields clear cleanly.
  for (const k of Object.keys(updates)) {
    if (updates[k] === "") updates[k] = null
  }

  // If the user changed the client mapping, never let both org and contact
  // be set at the same time — the schema treats them as alternatives. The
  // picker only sets one, but a manual API caller could break this.
  if (updates.organization_id && updates.contact_id) {
    return NextResponse.json(
      { error: "Set either organization_id or contact_id, not both" },
      { status: 400 },
    )
  }

  const admin = createAdminClient()

  // Refresh the denormalized organization_name / karbon_client_key so list
  // views and emails stay accurate when the user remaps a debrief.
  if (updates.organization_id !== undefined) {
    if (updates.organization_id) {
      const { data: org } = await admin
        .from("organizations")
        .select("name, karbon_organization_key")
        .eq("id", updates.organization_id)
        .single()
      if (org) {
        updates.organization_name = org.name
        updates.karbon_client_key = org.karbon_organization_key
      }
      // Picking an org clears any prior contact mapping so we don't end up
      // with a debrief that points at two different clients.
      updates.contact_id = null
    } else {
      updates.organization_name = null
    }
  }

  if (updates.contact_id !== undefined) {
    if (updates.contact_id) {
      const { data: contact } = await admin
        .from("contacts")
        .select("full_name, karbon_contact_key")
        .eq("id", updates.contact_id)
        .single()
      if (contact) {
        // organization_name is the historical "client display name" column —
        // re-use it for individuals so the table doesn't show a blank cell.
        updates.organization_name = contact.full_name
        updates.karbon_client_key = contact.karbon_contact_key
      }
      updates.organization_id = null
    } else if (!updates.organization_id) {
      updates.organization_name = null
      updates.karbon_client_key = null
    }
  }

  updates.updated_at = new Date().toISOString()

  const { data, error } = await admin
    .from("debriefs")
    .update(updates)
    .eq("id", id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ debrief: data })
}
