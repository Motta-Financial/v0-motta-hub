/**
 * Resolve a single contact update suggestion.
 *
 * POST /api/contacts/update-suggestions/[id]
 *   body: { action: "accept" | "dismiss" }
 *
 *   accept  → writes the suggested value onto the Hub contact (field-
 *             specific column mapping below) and marks the suggestion
 *             accepted.
 *   dismiss → keeps the current Hub value; the unique index on the
 *             suggestions table guarantees the same value is never
 *             re-suggested by a later sync tick.
 */
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers"
import { splitFullName } from "@/lib/karbon/mappers/contact"

export const dynamic = "force-dynamic"

type RouteCtx = { params: Promise<{ id: string }> }

export async function POST(req: Request, { params }: RouteCtx) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await getAuthenticatedUser(supabase)
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const action = body?.action as string | undefined
  if (action !== "accept" && action !== "dismiss") {
    return NextResponse.json(
      { error: "action must be 'accept' or 'dismiss'" },
      { status: 400 },
    )
  }

  const { data: suggestion, error: fetchErr } = await supabase
    .from("contact_update_suggestions")
    .select("id, contact_id, field, suggested_value, status")
    .eq("id", id)
    .maybeSingle()
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  if (!suggestion) return NextResponse.json({ error: "suggestion not found" }, { status: 404 })
  if (suggestion.status !== "pending") {
    return NextResponse.json(
      { error: `suggestion already ${suggestion.status}` },
      { status: 409 },
    )
  }

  if (action === "accept") {
    // Field → contacts column(s). full_name is a GENERATED column
    // (first_name || ' ' || last_name), so names are split and written to
    // the parts — same helper the Karbon sync uses.
    let patch: Record<string, unknown>
    switch (suggestion.field) {
      case "email":
        patch = { primary_email: suggestion.suggested_value }
        break
      case "phone":
        patch = { phone_primary: suggestion.suggested_value }
        break
      case "state":
        patch = { state: suggestion.suggested_value }
        break
      case "name": {
        const { first, last } = splitFullName(suggestion.suggested_value)
        if (!first) {
          return NextResponse.json(
            { error: "suggested name could not be parsed" },
            { status: 422 },
          )
        }
        patch = { first_name: first, last_name: last }
        break
      }
      default:
        return NextResponse.json({ error: "unknown field" }, { status: 422 })
    }

    const { error: applyErr } = await supabase
      .from("contacts")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", suggestion.contact_id)
    if (applyErr) return NextResponse.json({ error: applyErr.message }, { status: 500 })
  }

  const { error: resolveErr } = await supabase
    .from("contact_update_suggestions")
    .update({
      status: action === "accept" ? "accepted" : "dismissed",
      resolved_at: new Date().toISOString(),
      resolved_by: user.email ?? user.id,
    })
    .eq("id", id)
  if (resolveErr) return NextResponse.json({ error: resolveErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, action, field: suggestion.field })
}
