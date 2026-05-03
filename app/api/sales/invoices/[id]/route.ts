import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient, createClient } from "@/lib/supabase/server"

/**
 * PATCH /api/sales/invoices/[id]
 * ────────────────────────────────────────────────────────────────────────
 * Allow signed-in users to fix data on an Ignition invoice. The most
 * common cleanup is the client mapping (organization_id / contact_id)
 * because the import script falls back to fuzzy name matching for
 * historical rows; users also occasionally need to correct status when
 * something was paid outside Ignition / Stripe.
 */

const ALLOWED_FIELDS = new Set([
  "organization_id",
  "contact_id",
  "status",
  "amount",
  "amount_paid",
  "amount_outstanding",
  "currency",
  "invoice_date",
  "due_date",
  "paid_at",
  "voided_at",
  "invoice_number",
])

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing invoice id" }, { status: 400 })
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

  // Coerce numeric fields to numbers so PostgREST doesn't reject string
  // payloads like "1234.56" coming straight from a text input.
  for (const k of ["amount", "amount_paid", "amount_outstanding"]) {
    if (k in updates && updates[k] !== null) {
      const n = Number(updates[k])
      if (Number.isFinite(n)) updates[k] = n
      else delete updates[k]
    }
  }

  // Picking an org clears any prior contact mapping (and vice-versa) — an
  // invoice goes to either an org or an individual, never both.
  if (updates.organization_id) updates.contact_id = null
  if (updates.contact_id) updates.organization_id = null

  // If amount and amount_paid are both set but amount_outstanding wasn't,
  // recompute it. Saves the user a little arithmetic when they're marking
  // an invoice paid in full.
  if (
    "amount" in updates &&
    "amount_paid" in updates &&
    !("amount_outstanding" in updates)
  ) {
    const a = Number(updates.amount) || 0
    const p = Number(updates.amount_paid) || 0
    updates.amount_outstanding = Math.max(0, a - p)
  }

  updates.updated_at = new Date().toISOString()

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("ignition_invoices")
    .update(updates)
    .eq("ignition_invoice_id", id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ invoice: data })
}
