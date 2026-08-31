/**
 * Runs with the service-role client, matching /api/tax/clients and
 * /api/tax/returns.
 *
 * It used the session client at first and failed with "permission denied for
 * view tax_person_relationships_both". That is a missing GRANT, not an RLS
 * policy rejection — this project revokes default PostgREST grants (see
 * scripts/359), so new tables are unreachable by `authenticated` until
 * granted explicitly.
 *
 * Granting was the wrong fix here. Views in this schema run as their owner
 * and bypass base-table RLS for `authenticated` (scripts/359 documents this
 * and deliberately left it in place), and client-portal users hold
 * `authenticated` sessions in this same Supabase project. Granting the view
 * would have exposed every household — who is married to whom, who claims
 * which child — to any portal login.
 *
 * Staff-gating happens in middleware, which requires a session AND a
 * team_members row before any /api route runs. The is_staff() RLS policies on
 * both tables stay as defence in depth for any future caller that does use a
 * session client.
 */
import { NextResponse, type NextRequest } from "next/server"

import { createAdminClient } from "@/lib/supabase/server"

/**
 * Spouse links for the household model (scripts/404_tax_household_model.sql).
 *
 * `tax_person_relationships` stores the marriage ONCE, from whichever side
 * it was entered. We always read through `tax_person_relationships_both`,
 * which mirrors `spouse` / `former_spouse` rows in both directions, so the
 * spouse resolves regardless of who the link was entered against.
 *
 * RLS on both tables is `is_staff()`-gated (ALL), so this route uses the
 * per-request, cookie-authenticated client — never the service-role admin
 * client — and lets Postgres enforce staff-only access.
 */

type SpouseSide = {
  id: string
  contactId: string
  fullName: string | null
  hasSsn: boolean
  hasDateOfBirth: boolean
}

async function loadContactFlags(
  sb: ReturnType<typeof createAdminClient>,
  ids: string[],
): Promise<Map<string, { fullName: string | null; hasSsn: boolean; hasDateOfBirth: boolean }>> {
  const map = new Map<string, { fullName: string | null; hasSsn: boolean; hasDateOfBirth: boolean }>()
  if (ids.length === 0) return map
  const { data, error } = await sb
    .from("contacts")
    .select("id, full_name, ssn_encrypted, date_of_birth")
    .in("id", ids)
  if (error) throw error
  for (const row of data ?? []) {
    const r = row as Record<string, unknown>
    map.set(r.id as string, {
      fullName: (r.full_name as string | null) ?? null,
      hasSsn: !!r.ssn_encrypted && String(r.ssn_encrypted).trim() !== "",
      hasDateOfBirth: !!r.date_of_birth,
    })
  }
  return map
}

/**
 * GET /api/tax/household/spouse?contactId=<uuid>
 *
 * Returns the current spouse (effective_to IS NULL) if one exists, plus
 * the full marriage history (current + ended) for the audit trail.
 */
export async function GET(req: NextRequest) {
  try {
    const sb = createAdminClient()
    const { searchParams } = new URL(req.url)
    const contactId = searchParams.get("contactId")
    if (!contactId) {
      return NextResponse.json({ error: "contactId required" }, { status: 400 })
    }

    const { data, error } = await sb
      .from("tax_person_relationships_both")
      .select("*")
      .eq("subject_contact_id", contactId)
      .in("relationship_type", ["spouse", "former_spouse"])
      .order("effective_from", { ascending: false, nullsFirst: false })

    if (error) {
      console.error("[v0] /api/tax/household/spouse GET failed", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const rows = data ?? []
    const otherIds = Array.from(new Set(rows.map((r) => r.object_contact_id as string)))
    const flags = await loadContactFlags(sb, otherIds)

    const toSide = (row: Record<string, unknown>): SpouseSide => {
      const objectId = row.object_contact_id as string
      const f = flags.get(objectId)
      return {
        id: row.id as string,
        contactId: objectId,
        fullName: f?.fullName ?? null,
        hasSsn: f?.hasSsn ?? false,
        hasDateOfBirth: f?.hasDateOfBirth ?? false,
      }
    }

    // "Current" is a marriage (not former_spouse) with no end date.
    const current = rows.find(
      (r) => r.relationship_type === "spouse" && r.effective_to == null,
    )

    return NextResponse.json({
      ok: true,
      current: current ? toSide(current as Record<string, unknown>) : null,
      history: rows.map((r) => ({
        ...toSide(r as Record<string, unknown>),
        relationshipType: r.relationship_type,
        effectiveFrom: r.effective_from,
        effectiveTo: r.effective_to,
        status: r.status,
      })),
    })
  } catch (err) {
    console.error("[v0] /api/tax/household/spouse GET threw", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to load spouse" },
      { status: 500 },
    )
  }
}

/**
 * POST /api/tax/household/spouse
 *
 * Body shape A (add):
 *   { action: "add", contactId, spouseContactId, effectiveFrom?: "YYYY-MM-DD", notes?: string }
 *
 * Body shape B (end a marriage):
 *   { action: "end", id: "<relationship_id>", effectiveTo: "YYYY-MM-DD", notes?: string }
 *
 * Ending a marriage NEVER deletes the row — it sets effective_to so a
 * prior year's return stays reconstructable. The UI must say "ended",
 * never "removed".
 */
export async function POST(req: NextRequest) {
  try {
    const sb = createAdminClient()
    const body = (await req.json().catch(() => null)) as
      | { action: "add"; contactId: string; spouseContactId: string; effectiveFrom?: string; notes?: string }
      | { action: "end"; id: string; effectiveTo: string; notes?: string }
      | null

    if (!body) return NextResponse.json({ error: "body required" }, { status: 400 })

    if (body.action === "add") {
      if (!body.contactId || !body.spouseContactId) {
        return NextResponse.json(
          { error: "contactId and spouseContactId required" },
          { status: 400 },
        )
      }
      if (body.contactId === body.spouseContactId) {
        return NextResponse.json(
          { error: "A client cannot be their own spouse" },
          { status: 400 },
        )
      }

      const { data, error } = await sb
        .from("tax_person_relationships")
        .insert({
          person_contact_id: body.contactId,
          related_contact_id: body.spouseContactId,
          relationship_type: "spouse",
          status: "confirmed",
          link_source: "manual",
          confidence: 1,
          effective_from: body.effectiveFrom ?? null,
          reviewed_at: new Date().toISOString(),
          notes: body.notes ?? null,
        })
        .select("id")
        .single()

      if (error) {
        console.error("[v0] add spouse failed", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      return NextResponse.json({ ok: true, id: data.id })
    }

    if (body.action === "end") {
      if (!body.id || !body.effectiveTo) {
        return NextResponse.json({ error: "id and effectiveTo required" }, { status: 400 })
      }
      // Setting effective_to is enough to mark the marriage as ended —
      // the row (and its relationship_type = "spouse") stays exactly as
      // it was for the years it was current, which is what makes a
      // prior year's return reconstructable.
      const { error } = await sb
        .from("tax_person_relationships")
        .update({
          effective_to: body.effectiveTo,
          notes: body.notes ?? null,
        })
        .eq("id", body.id)
      if (error) {
        console.error("[v0] end marriage failed", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 })
  } catch (err) {
    console.error("[v0] /api/tax/household/spouse POST threw", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "spouse update failed" },
      { status: 500 },
    )
  }
}
