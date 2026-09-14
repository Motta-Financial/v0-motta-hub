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
 * The portal's My Account page labels its two editable fields for humans;
 * contact_update_suggestions keys them by column concept. Anything not in
 * this map is still recorded in the message thread but cannot be approved,
 * which is the safe direction to fail.
 */
const SUGGESTION_FIELDS: Record<string, "phone" | "address"> = {
  "Phone number": "phone",
  "Mailing address": "address",
}

/**
 * POST /api/client-portal/client-info
 * Body: { changes: Record<string, string> }
 *
 * Submits a change request TWO ways, on purpose:
 *   1. As rows in contact_update_suggestions, so staff can approve or
 *      dismiss each field from /admin/contact-updates and an approval
 *      writes the value onto the contact.
 *   2. As a portal_message, so the change is also visible in the thread
 *      the client already uses and staff already read.
 *
 * Before this, only (2) happened -- the change was a chat message and
 * nothing could approve it. Karbon stays the source of truth for the
 * underlying record; this queue is how a change reaches it.
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

  // portal_messages has no client_id — attach the change request to the
  // caller's first linked entity (prefer a personal contact record).
  const contactId = portalUser.contactIds[0] ?? null
  const organizationId = contactId ? null : portalUser.organizationIds[0] ?? null

  if (!contactId && !organizationId) {
    return NextResponse.json({ error: "No linked account found" }, { status: 400 })
  }

  const supabase = await createClient()

  const { error } = await supabase.from("portal_messages").insert({
    contact_id: contactId,
    organization_id: organizationId,
    sender_portal_user_id: portalUser.id,
    sender_role: "client",
    sender_name: portalUser.fullName ?? portalUser.email,
    body,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // ── The approvable half ────────────────────────────────────────────────
  // contact_update_suggestions.contact_id is NOT NULL, so an
  // organization-only portal login has nowhere to file one. Those changes
  // stay message-only rather than being dropped or mis-filed against some
  // arbitrary contact.
  let suggestionsQueued = 0
  if (contactId) {
    const { data: contact } = await supabase
      .from("contacts")
      .select(
        "phone_primary, mailing_address_line1, mailing_city, mailing_state, mailing_zip_code",
      )
      .eq("id", contactId)
      .maybeSingle()

    // Same join the My Account page uses to render the address as one
    // line, so "current value" in the review queue matches what the client
    // was actually looking at when they edited it.
    const currentAddress = [
      contact?.mailing_address_line1,
      contact?.mailing_city,
      contact?.mailing_state,
      contact?.mailing_zip_code,
    ]
      .filter(Boolean)
      .join(", ")

    const rows = entries.flatMap(([label, value]) => {
      const field = SUGGESTION_FIELDS[label]
      if (!field) return []
      return [
        {
          contact_id: contactId,
          field,
          current_value: field === "phone" ? contact?.phone_primary ?? null : currentAddress || null,
          suggested_value: value.trim(),
          source: "client_portal",
          source_ref: portalUser.id,
          source_captured_at: new Date().toISOString(),
          status: "pending",
        },
      ]
    })

    if (rows.length > 0) {
      // The unique index spans all statuses, so re-submitting a value the
      // client already sent (or that staff already dismissed) is a no-op
      // rather than a duplicate row or a 500.
      const { error: suggestErr } = await supabase
        .from("contact_update_suggestions")
        .upsert(rows, {
          onConflict: "contact_id,field,source,suggested_value",
          ignoreDuplicates: true,
        })

      // A failure here must not lose the client's change -- the message
      // above already succeeded, so report success and leave a trail.
      if (suggestErr) {
        console.error("Change request queued as message but not approvable:", suggestErr)
      } else {
        suggestionsQueued = rows.length
      }
    }
  }

  return NextResponse.json({ ok: true, suggestionsQueued })
}
