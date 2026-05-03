import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient, createClient } from "@/lib/supabase/server"
import { normalizeState, US_STATE_NAMES } from "@/lib/sales/us-geo"

/**
 * PATCH /api/sales/proposals/[id]/state
 * ────────────────────────────────────────────────────────────────────────
 * Update the *client's* state for a single proposal. There is no `state`
 * column on `ignition_proposals` — state is derived from the linked CRM
 * entity. So this endpoint figures out which underlying row owns the
 * state for this proposal and writes there:
 *
 *   1. organization (preferred) — `organizations.state`
 *   2. contact                 — `contacts.state`
 *   3. ignition_clients         — `ignition_clients.state` (last resort
 *                                 when there's no linked CRM record)
 *
 * Body: { state: "MA" | "Massachusetts" | "" | null, city?: string|null }
 *
 * Returns the proposal id, normalized state, and which entity was
 * updated so the client can confirm the write target without re-fetching.
 */

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing proposal id" }, { status: 400 })
  }

  // Auth gate (same model as the rest of /api/sales/*)
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

  let body: { state?: string | null; city?: string | null }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  // Normalize: any 2-letter abbreviation, full name (case-insensitive),
  // or empty string (meaning "clear"). Reject anything else so we don't
  // pollute the column with junk like "Florida (residence)".
  const rawState = body.state == null ? null : String(body.state).trim()
  let nextState: string | null = null
  if (rawState && rawState.length > 0) {
    const norm = normalizeState(rawState)
    if (!norm || !(norm in US_STATE_NAMES)) {
      return NextResponse.json(
        { error: `Unknown US state: "${rawState}"` },
        { status: 400 },
      )
    }
    nextState = norm
  }
  const nextCity =
    body.city == null
      ? undefined
      : String(body.city).trim() === ""
      ? null
      : String(body.city).trim()

  const admin = createAdminClient()

  // Look up the proposal's link targets in priority order.
  const { data: proposal, error: pErr } = await admin
    .from("ignition_proposals")
    .select("proposal_id, organization_id, contact_id, ignition_client_id")
    .eq("proposal_id", id)
    .single()
  if (pErr || !proposal) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 })
  }

  const updates: Record<string, any> = { state: nextState, updated_at: new Date().toISOString() }
  if (nextCity !== undefined) updates.city = nextCity

  let target: "organization" | "contact" | "ignition_client" | null = null
  let writeError: string | null = null

  if (proposal.organization_id) {
    const { error } = await admin
      .from("organizations")
      .update(updates)
      .eq("id", proposal.organization_id)
    if (error) writeError = error.message
    else target = "organization"
  } else if (proposal.contact_id) {
    const { error } = await admin
      .from("contacts")
      .update(updates)
      .eq("id", proposal.contact_id)
    if (error) writeError = error.message
    else target = "contact"
  } else if (proposal.ignition_client_id) {
    const { error } = await admin
      .from("ignition_clients")
      .update(updates)
      .eq("ignition_client_id", proposal.ignition_client_id)
    if (error) writeError = error.message
    else target = "ignition_client"
  } else {
    return NextResponse.json(
      {
        error:
          "This proposal has no linked client record to attach a state to. Edit the proposal first to link an organization or contact.",
      },
      { status: 400 },
    )
  }

  if (writeError) {
    return NextResponse.json({ error: writeError }, { status: 500 })
  }

  return NextResponse.json({
    proposal_id: id,
    state: nextState,
    city: nextCity ?? null,
    updated: target,
  })
}
