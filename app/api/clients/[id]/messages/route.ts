/**
 * Staff side of the client portal message thread.
 *
 * The portal has had a working Messages page since scripts/351, but nothing
 * outside `/api/client-portal/*` ever read `portal_messages` — so a client
 * could send a message that no one at the firm could see. This route is the
 * missing half, consumed by the Messages sub-tab on the client profile
 * (components/client-profile.tsx).
 *
 * Auth: middleware already requires a session AND a `team_members` row before
 * any non-portal `/api` route runs, so a portal client cannot reach this. We
 * still use the per-request cookie client rather than the service-role admin
 * client, so the `is_staff()` policies on `portal_messages`
 * (scripts/351_client_portal_auth.sql) enforce access in Postgres as defence
 * in depth.
 *
 * Threads are scoped by `contact_id` / `organization_id` — `portal_messages`
 * has no client_id, and exactly one of the two is set per row.
 */
import { NextResponse, type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getTeamMemberByAuthId } from "@/lib/team-members"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Entity = { kind: "contact" | "organization"; id: string }

/**
 * Mirrors resolveEntity in app/api/clients/[id]/route.ts: the profile page
 * routes by either UUID or Karbon perma-key, so this must accept both or the
 * Messages tab breaks on exactly the clients reached from a Karbon link.
 */
async function resolveEntity(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string,
): Promise<Entity | null> {
  const isUuid = UUID_RE.test(id)

  const { data: contact } = await supabase
    .from("contacts")
    .select("id")
    .or(isUuid ? `id.eq.${id},karbon_contact_key.eq.${id}` : `karbon_contact_key.eq.${id}`)
    .limit(1)
    .maybeSingle()
  if (contact) return { kind: "contact", id: contact.id }

  const { data: org } = await supabase
    .from("organizations")
    .select("id")
    .or(
      isUuid
        ? `id.eq.${id},karbon_organization_key.eq.${id}`
        : `karbon_organization_key.eq.${id}`,
    )
    .limit(1)
    .maybeSingle()
  if (org) return { kind: "organization", id: org.id }

  return null
}

function entityColumn(entity: Entity): "contact_id" | "organization_id" {
  return entity.kind === "organization" ? "organization_id" : "contact_id"
}

/** Shape the profile's Messages sub-tab renders. */
function toClientShape(row: {
  id: string
  sender_role: string
  sender_name: string
  body: string
  created_at: string
  read_at: string | null
}) {
  return {
    id: row.id,
    // The UI calls the firm side "firm"; the column stores 'team_member'.
    sender: row.sender_role === "client" ? ("client" as const) : ("firm" as const),
    senderName: row.sender_name,
    bodyText: row.body,
    sentAt: row.created_at,
    // Only meaningful on firm messages, where it means the client opened
    // the thread after we sent it (scripts/417).
    seenByClient: row.read_at !== null,
  }
}

/**
 * GET /api/clients/[id]/messages
 * The whole thread for this client, oldest first.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    const entity = await resolveEntity(supabase, id)
    if (!entity) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 })
    }

    const { data, error } = await supabase
      .from("portal_messages")
      .select("id, sender_role, sender_name, body, created_at, read_at")
      .eq(entityColumn(entity), entity.id)
      .order("created_at", { ascending: true })

    if (error) throw error

    const messages = data ?? []

    // Staff opening the tab is the receipt for the CLIENT's messages. The
    // client side does the mirror of this for ours. Best-effort: a failed
    // stamp must not stop staff reading the thread.
    const unseenFromClient = messages
      .filter((m) => m.sender_role === "client" && m.read_at === null)
      .map((m) => m.id)

    if (unseenFromClient.length > 0) {
      const { error: stampError } = await supabase
        .from("portal_messages")
        .update({ read_at: new Date().toISOString() })
        .in("id", unseenFromClient)
        .is("read_at", null)
      if (stampError) {
        console.error("Could not stamp client message read receipts:", stampError)
      }
    }

    return NextResponse.json({ messages: messages.map(toClientShape) })
  } catch (error) {
    console.error("Error loading portal messages:", error)
    return NextResponse.json({ error: "Failed to load messages" }, { status: 500 })
  }
}

/**
 * POST /api/clients/[id]/messages
 * Body: { body: string }
 * Posts a reply from the signed-in staff member into the client's thread.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const teamMember = await getTeamMemberByAuthId(user.id, user.email)
    if (!teamMember) {
      return NextResponse.json({ error: "Not a team member" }, { status: 403 })
    }

    let body: string
    try {
      const json = await request.json()
      body = (json?.body ?? "").trim()
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
    }

    if (!body) {
      return NextResponse.json({ error: "Message body is required" }, { status: 400 })
    }
    // Same 4000-char ceiling the portal's own POST enforces, so neither side
    // of the thread can write a message the other side would reject.
    if (body.length > 4000) {
      return NextResponse.json({ error: "Message too long (max 4000 chars)" }, { status: 400 })
    }

    const entity = await resolveEntity(supabase, id)
    if (!entity) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 })
    }

    const { data, error } = await supabase
      .from("portal_messages")
      .insert({
        contact_id: entity.kind === "contact" ? entity.id : null,
        organization_id: entity.kind === "organization" ? entity.id : null,
        sender_team_member_id: teamMember.id,
        sender_role: "team_member",
        sender_name: teamMember.full_name ?? teamMember.email ?? "Motta Financial",
        body,
      })
      .select("id, sender_role, sender_name, body, created_at, read_at")
      .single()

    if (error) throw error

    return NextResponse.json({ message: toClientShape(data) }, { status: 201 })
  } catch (error) {
    console.error("Error sending portal message:", error)
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 })
  }
}
