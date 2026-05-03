import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = createAdminClient()
    const body = await request.json()

    // Whitelist of editable columns
    const updates: Record<string, any> = {}
    const allowedFields = [
      "team_member_id",
      "debrief_date",
      "debrief_type",
      "status",
      "notes",
      "follow_up_date",
      "tax_year",
      "filing_status",
      "adjusted_gross_income",
      "taxable_income",
      "has_schedule_c",
      "has_schedule_e",
    ]

    for (const field of allowedFields) {
      if (field in body) {
        updates[field] = body[field] === "" ? null : body[field]
      }
    }

    // If updating team_member_id, also update the cached team_member_name in action_items JSONB
    if (body.team_member_id) {
      const { data: tm } = await supabase
        .from("team_members")
        .select("full_name")
        .eq("id", body.team_member_id)
        .single()

      if (tm) {
        const { data: existing } = await supabase
          .from("debriefs")
          .select("action_items")
          .eq("id", id)
          .single()

        const existingActionItems = (existing?.action_items as any) || {}
        updates.action_items = {
          ...existingActionItems,
          team_member_name: tm.full_name,
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 })
    }

    const { data, error } = await supabase
      .from("debriefs")
      .update(updates)
      .eq("id", id)
      .select(
        `
        *,
        contact:contacts(full_name),
        organization:organizations(name),
        work_item:work_items(title, karbon_work_item_key),
        team_member:team_members!team_member_id(id, full_name, avatar_url, email),
        created_by:team_members!created_by_id(id, full_name)
      `,
      )
      .single()

    if (error) {
      console.error("[v0] PATCH debrief error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ debrief: data })
  } catch (err) {
    console.error("[v0] Failed to update debrief:", err)
    const message = err instanceof Error ? err.message : "Failed to update debrief"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = createAdminClient()

    const { error } = await supabase.from("debriefs").delete().eq("id", id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete debrief"
    return NextResponse.json({ error: message }, { status: 500 })
  }
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
// prevents accidental writes to internal columns (created_at, ids that
// should only be derived from the linked client, etc.).
//
// Originally this was a tight set covering just the client mapping, type,
// status, notes, follow-up, and Karbon URL. We expanded it to cover every
// field the edit sheet exposes so partners can backfill missing values
// (date, team member, manager/owner, full tax block, schedules, financial
// totals, action items) without having to drop into Supabase.
const ALLOWED_FIELDS = new Set([
  // Client / work item mapping
  "organization_id",
  "contact_id",
  "work_item_id",
  // Date & people
  "debrief_date",
  "team_member_id",
  "client_manager_id",
  "client_manager_name",
  "client_owner_id",
  "client_owner_name",
  // Classification
  "debrief_type",
  "status",
  // Free-text + structured payload
  "notes",
  "action_items",
  // Tax block
  "tax_year",
  "filing_status",
  "adjusted_gross_income",
  "taxable_income",
  "has_schedule_c",
  "has_schedule_e",
  // Financial
  "recurring_revenue",
  // Follow-up + Karbon link
  "follow_up_date",
  "karbon_work_url",
])

// Numeric fields — coerced to a finite Number or null. Empty string and
// invalid values become null so a cleared input clears the column.
const NUMERIC_FIELDS = new Set([
  "tax_year",
  "adjusted_gross_income",
  "taxable_income",
  "recurring_revenue",
])

// Boolean fields — coerced from "true"/"false"/0/1/null into a real
// boolean or null.
const BOOLEAN_FIELDS = new Set(["has_schedule_c", "has_schedule_e"])

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

  // Numeric fields: tolerate strings (the form uses <Input type="number">
  // which submits as a string). Non-finite values become null so a typo
  // never lands a NaN in the database.
  for (const k of NUMERIC_FIELDS) {
    if (!(k in updates)) continue
    const raw = updates[k]
    if (raw === null || raw === undefined) {
      updates[k] = null
      continue
    }
    const n = typeof raw === "number" ? raw : Number(raw)
    updates[k] = Number.isFinite(n) ? n : null
  }

  // Boolean fields: <Checkbox> emits a real boolean, but be defensive in
  // case a caller posts strings or 0/1.
  for (const k of BOOLEAN_FIELDS) {
    if (!(k in updates)) continue
    const raw = updates[k]
    if (raw === null || raw === undefined) {
      updates[k] = null
    } else if (typeof raw === "boolean") {
      updates[k] = raw
    } else {
      updates[k] = raw === true || raw === "true" || raw === 1 || raw === "1"
    }
  }

  // Action items is a JSONB column shaped like { items: [{description,
  // assignee_name, due_date, priority}] }. Accept either the wrapped
  // object or a bare array and coerce to the wrapped shape so the read
  // path (which always indexes `.items`) doesn't have to special-case
  // older payloads.
  if ("action_items" in updates) {
    const raw = updates.action_items
    if (raw === null) {
      updates.action_items = null
    } else if (Array.isArray(raw)) {
      updates.action_items = { items: raw }
    } else if (raw && typeof raw === "object" && Array.isArray((raw as any).items)) {
      // Already in canonical shape — pass through.
    } else {
      // Unknown shape (e.g. a stray string). Drop the update rather than
      // corrupt the JSON column.
      delete updates.action_items
    }
  }

  // Date-only fields: HTML <input type="date"> emits "YYYY-MM-DD" which
  // Postgres accepts directly, so no extra coercion needed here.

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

  // When the user picks a different client manager / owner via the
  // team-member dropdown, refresh the denormalized name column off the
  // canonical team_members row. This mirrors what we do for
  // organization_name when the org changes, and keeps the list view
  // (which reads *_name directly) consistent without a second round-trip.
  if (updates.client_manager_id !== undefined) {
    if (updates.client_manager_id) {
      const { data: tm } = await admin
        .from("team_members")
        .select("full_name")
        .eq("id", updates.client_manager_id)
        .single()
      // Only auto-fill the name when the caller didn't send one — lets a
      // power user override the display string if they need to.
      if (tm && updates.client_manager_name === undefined) {
        updates.client_manager_name = tm.full_name
      }
    } else {
      updates.client_manager_name = null
    }
  }
  if (updates.client_owner_id !== undefined) {
    if (updates.client_owner_id) {
      const { data: tm } = await admin
        .from("team_members")
        .select("full_name")
        .eq("id", updates.client_owner_id)
        .single()
      if (tm && updates.client_owner_name === undefined) {
        updates.client_owner_name = tm.full_name
      }
    } else {
      updates.client_owner_name = null
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
