import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient, createClient } from "@/lib/supabase/server"

/**
 * PATCH /api/sales/proposals/[id]
 * ────────────────────────────────────────────────────────────────────────
 * Edit Ignition proposal data. Same auth model as the other Sales edit
 * endpoints: signed-in users only, write goes through admin client.
 *
 * Proposals only carry an organization_id (no contact_id), so the client
 * picker on the edit sheet is configured to organizations-only — but the
 * `client_name` column is still editable for the (rare) case where a
 * proposal isn't tied to a CRM org row.
 */

const ALLOWED_FIELDS = new Set([
  "organization_id",
  "client_name",
  "title",
  "status",
  "total_value",
  "one_time_total",
  "recurring_total",
  "recurring_frequency",
  "currency",
])

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing proposal id" }, { status: 400 })
  }

  // Auth gate
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

  const updates: Record<string, any> = {}
  for (const k of Object.keys(body)) {
    if (ALLOWED_FIELDS.has(k)) updates[k] = body[k]
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No editable fields supplied" }, { status: 400 })
  }
  for (const k of Object.keys(updates)) {
    if (updates[k] === "") updates[k] = null
  }
  for (const k of ["total_value", "one_time_total", "recurring_total"]) {
    if (k in updates && updates[k] !== null) {
      const n = Number(updates[k])
      if (Number.isFinite(n)) updates[k] = n
      else delete updates[k]
    }
  }

  const admin = createAdminClient()

  // When the user picks a different org, refresh `client_name` from the
  // canonical `organizations.name` so the proposals table stays consistent
  // with what the dashboard pivots show.
  if (updates.organization_id) {
    const { data: org } = await admin
      .from("organizations")
      .select("name")
      .eq("id", updates.organization_id)
      .single()
    if (org && !("client_name" in updates)) {
      updates.client_name = org.name
    }
  }

  updates.updated_at = new Date().toISOString()

  const { data, error } = await admin
    .from("ignition_proposals")
    .update(updates)
    .eq("proposal_id", id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ proposal: data })
}
