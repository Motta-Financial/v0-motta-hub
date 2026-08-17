import { requirePortalAuth } from "@/lib/portal/require-portal-auth"
import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"

/**
 * GET /api/client-portal/messages
 * Returns every message tied to any contact/organization this portal
 * login has access to, oldest first. portal_messages has no client_id —
 * threads are scoped via contact_id / organization_id directly, and there
 * is no read_at column, so unread-tracking is not implemented here.
 */
export async function GET() {
  const auth = await requirePortalAuth()
  if (!auth.ok) return auth.response

  const { portalUser } = auth
  const supabase = await createClient()

  const orFilters = [
    portalUser.contactIds.length > 0 ? `contact_id.in.(${portalUser.contactIds.join(",")})` : null,
    portalUser.organizationIds.length > 0
      ? `organization_id.in.(${portalUser.organizationIds.join(",")})`
      : null,
  ].filter(Boolean)

  if (orFilters.length === 0) {
    return NextResponse.json({ messages: [] })
  }

  const { data: messages, error } = await supabase
    .from("portal_messages")
    .select("id, sender_role, sender_name, body, created_at, contact_id, organization_id")
    .or(orFilters.join(","))
    .order("created_at", { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ messages: messages ?? [] })
}

/**
 * POST /api/client-portal/messages
 * Body: { body: string, contactId?: string, organizationId?: string }
 * Creates a new message from the client in their portal thread, attached
 * to one of the caller's own linked entities. Defaults to the first
 * available entity when the caller doesn't specify one.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePortalAuth()
  if (!auth.ok) return auth.response

  const { portalUser } = auth

  let body: string
  let requestedContactId: string | undefined
  let requestedOrganizationId: string | undefined
  try {
    const json = await request.json()
    body = (json.body ?? "").trim()
    requestedContactId = json.contactId
    requestedOrganizationId = json.organizationId
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (!body) {
    return NextResponse.json({ error: "Message body is required" }, { status: 400 })
  }

  if (body.length > 4000) {
    return NextResponse.json({ error: "Message too long (max 4000 chars)" }, { status: 400 })
  }

  // Resolve which entity this message is attached to, verifying the
  // caller actually has access to whatever they requested.
  let contactId: string | null = null
  let organizationId: string | null = null

  if (requestedContactId) {
    if (!portalUser.contactIds.includes(requestedContactId)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    contactId = requestedContactId
  } else if (requestedOrganizationId) {
    if (!portalUser.organizationIds.includes(requestedOrganizationId)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    organizationId = requestedOrganizationId
  } else if (portalUser.contactIds.length > 0) {
    contactId = portalUser.contactIds[0]
  } else if (portalUser.organizationIds.length > 0) {
    organizationId = portalUser.organizationIds[0]
  } else {
    return NextResponse.json({ error: "No linked account found" }, { status: 400 })
  }

  const supabase = await createClient()

  const { data: message, error } = await supabase
    .from("portal_messages")
    .insert({
      contact_id: contactId,
      organization_id: organizationId,
      sender_portal_user_id: portalUser.id,
      sender_role: "client",
      sender_name: portalUser.fullName ?? portalUser.email,
      body,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ message }, { status: 201 })
}
