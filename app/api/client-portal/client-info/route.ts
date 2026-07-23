import { requirePortalAuth } from "@/lib/portal/require-portal-auth"
import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"

/**
 * GET /api/client-portal/client-info
 * Returns the Karbon contact snapshot for the current portal user's client.
 * Also returns all portal_users linked to the same client_id (authorized contacts).
 */
export async function GET() {
  const auth = await requirePortalAuth()
  if (!auth.ok) return auth.response

  const { portalUser } = auth
  const supabase = await createClient()

  // Try contact first, then organization
  let contact: Record<string, unknown> | null = null

  const { data: c } = await supabase
    .from("supabase_contacts")
    .select(`
      id, first_name, last_name, email,
      phone_numbers, physical_addresses,
      client_manager_key, client_partner_key
    `)
    .eq("id", portalUser.clientId)
    .maybeSingle()

  if (c) {
    contact = c
  } else {
    const { data: org } = await supabase
      .from("supabase_organizations")
      .select("id, name, email, phone_number, address")
      .eq("id", portalUser.clientId)
      .maybeSingle()
    if (org) contact = org
  }

  // Other portal users on this account (authorized contacts)
  const { data: contacts } = await supabase
    .from("portal_users")
    .select("id, full_name, email, role")
    .eq("client_id", portalUser.clientId)
    .eq("is_active", true)
    .neq("id", portalUser.id)

  return NextResponse.json({
    contact,
    authorizedContacts: contacts ?? [],
  })
}

/**
 * POST /api/client-portal/client-info
 * Body: { changes: Record<string, string> }
 * Submits a change request as a portal_message (Karbon stays the source of truth).
 */
export async function POST(request: NextRequest) {
  const auth = await requirePortalAuth()
  if (!auth.ok) return auth.response

  const { portalUser } = auth

  let changes: Record<string, string>
  try {
    const json = await request.json()
    changes = json.changes ?? {}
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const entries = Object.entries(changes).filter(([, v]) => v?.trim())
  if (entries.length === 0) {
    return NextResponse.json({ error: "No changes provided" }, { status: 400 })
  }

  // Format the change request as a human-readable message
  const lines = entries.map(([field, value]) => `• ${field}: ${value}`)
  const body = `Information update request:\n\n${lines.join("\n")}\n\nPlease update these details in Karbon.`

  const supabase = await createClient()

  const { error } = await supabase.from("portal_messages").insert({
    client_id: portalUser.clientId,
    sender_id: portalUser.id,
    sender_role: "client",
    sender_name: portalUser.fullName ?? portalUser.email,
    body,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
