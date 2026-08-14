import { requirePortalAuth } from "@/lib/portal/require-portal-auth"
import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"

/**
 * GET /api/client-portal/client-info
 * Returns the contact/organization snapshot(s) for every entity linked to
 * the current portal login, plus the other active portal users who share
 * access to those same entities (authorized contacts).
 */
export async function GET() {
  const auth = await requirePortalAuth()
  if (!auth.ok) return auth.response

  const { portalUser } = auth
  const supabase = await createClient()

  const [{ data: contacts }, { data: organizations }] = await Promise.all([
    portalUser.contactIds.length > 0
      ? supabase
          .from("contacts")
          .select(
            "id, full_name, first_name, last_name, primary_email, phone_primary, mailing_address_line1, mailing_city, mailing_state, mailing_zip_code, client_manager_key, client_partner_key",
          )
          .in("id", portalUser.contactIds)
      : Promise.resolve({ data: [] }),
    portalUser.organizationIds.length > 0
      ? supabase
          .from("organizations")
          .select("id, name, primary_email, phone, client_manager_key, client_partner_key")
          .in("id", portalUser.organizationIds)
      : Promise.resolve({ data: [] }),
  ])

  // Other active portal users who have access to any of the same
  // contact/organization entities (authorized contacts on this account).
  const { data: sharedAccess } = await supabase
    .from("portal_user_access")
    .select("portal_user_id")
    .or(
      [
        portalUser.contactIds.length > 0
          ? `contact_id.in.(${portalUser.contactIds.join(",")})`
          : null,
        portalUser.organizationIds.length > 0
          ? `organization_id.in.(${portalUser.organizationIds.join(",")})`
          : null,
      ]
        .filter(Boolean)
        .join(","),
    )

  const sharedUserIds = Array.from(
    new Set((sharedAccess ?? []).map((a) => a.portal_user_id)),
  ).filter((id) => id !== portalUser.id)

  let authorizedContacts: unknown[] = []
  if (sharedUserIds.length > 0) {
    const { data: users } = await supabase
      .from("portal_users")
      .select("id, full_name, email")
      .in("id", sharedUserIds)
      .eq("is_active", true)
    authorizedContacts = users ?? []
  }

  return NextResponse.json({
    contacts: contacts ?? [],
    organizations: organizations ?? [],
    authorizedContacts,
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
