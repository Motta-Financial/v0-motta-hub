import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient, createClient } from "@/lib/supabase/server"
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers"
import { getTeamMemberByAuthId } from "@/lib/team-members"

/**
 * Resolve the signed-in user, plus their team_members row when we can find
 * one. Any signed-in team member may delete a debrief (mirrors the PATCH
 * policy above — the Hub is a small internal tool and partners routinely
 * clean up each other's records), but we always record *who* did it.
 *
 * Returns null when there is no valid session.
 */
async function resolveActor() {
  try {
    const auth = await createClient()
    const {
      data: { user },
    } = await getAuthenticatedUser(auth)
    if (!user) return null

    // Best-effort: a missing team_members row shouldn't block the delete,
    // it just leaves deleted_by_id null.
    const member = await getTeamMemberByAuthId(user.id, user.email)
    return { user, memberId: member?.id ?? null }
  } catch {
    return null
  }
}

/**
 * DELETE /api/debriefs/[id]
 * ────────────────────────────────────────────────────────────────────────
 * Soft-deletes a debrief by stamping `deleted_at` / `deleted_by_id` /
 * `deleted_reason` (migration 351). The row is retained so a mistaken
 * delete is recoverable via PATCH ?restore=1.
 *
 * We deliberately do NOT hard-delete: debriefs feed client profiles, deal
 * stats, the daily briefing, global search, and the meeting timeline. The
 * debriefs_* views (and deals_enriched / hub_meetings_enriched) filter
 * `deleted_at IS NULL`, so a soft-deleted debrief disappears from every
 * read path immediately without losing history.
 *
 * Optional JSON body: { reason?: string }
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: "Missing debrief id" }, { status: 400 })
    }

    const actor = await resolveActor()
    if (!actor) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    // Body is optional — a bare DELETE with no payload is valid.
    let reason: string | null = null
    try {
      const body = await request.json()
      const raw = typeof body?.reason === "string" ? body.reason.trim() : ""
      reason = raw.length > 0 ? raw.slice(0, 500) : null
    } catch {
      // No/invalid body: leave reason null.
    }

    const supabase = createAdminClient()

    // Only stamp rows that are still live, so a double-submit can't
    // overwrite the original deleter/timestamp. `.select()` lets us tell
    // "already deleted" apart from "no such debrief".
    const { data, error } = await supabase
      .from("debriefs")
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by_id: actor.memberId,
        deleted_reason: reason,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!data) {
      // Either the id doesn't exist or it was already soft-deleted. Check
      // which so the client can show something useful.
      const { data: existing } = await supabase
        .from("debriefs")
        .select("id, deleted_at")
        .eq("id", id)
        .maybeSingle()

      if (!existing) {
        return NextResponse.json({ error: "Debrief not found" }, { status: 404 })
      }
      // Idempotent: already deleted is a success from the caller's POV.
      return NextResponse.json({ success: true, alreadyDeleted: true })
    }

    return NextResponse.json({ success: true, id: data.id })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete debrief"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * Restoring a soft-deleted debrief is handled by PATCH — see the
 * `?restore=1` branch near the top of the PATCH handler below. Route files
 * may only export HTTP-method handlers, so there's no helper export here.
 */

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
  //
  // Uses the local JWT-signature check (no GoTrue network call) — see
  // `lib/supabase/auth-helpers.ts` for the rationale. The middleware
  // already ran a `getSession()` to gate access to this route, so an
  // additional `getUser()` round-trip here was pure overhead that
  // contributed to the per-IP auth rate limit.
  if (!(await resolveActor())) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  // Restore branch: `PATCH /api/debriefs/[id]?restore=1` clears the
  // soft-delete stamp set by DELETE. Handled before body parsing because a
  // restore takes no payload.
  if (request.nextUrl.searchParams.get("restore") === "1") {
    const { data, error } = await createAdminClient()
      .from("debriefs")
      .update({
        deleted_at: null,
        deleted_by_id: null,
        deleted_reason: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id")
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: "Debrief not found" }, { status: 404 })
    }
    return NextResponse.json({ success: true, restored: true, id: data.id })
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
