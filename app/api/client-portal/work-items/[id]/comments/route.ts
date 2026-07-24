/**
 * GET  /api/client-portal/work-items/[id]/comments
 * POST /api/client-portal/work-items/[id]/comments
 *
 * Karbon-style per-task discussion thread. These comments live on the
 * work item and are intentionally SEPARATE from the main portal message
 * thread (`portal_messages`) so task-specific back-and-forth doesn't get
 * buried in general correspondence.
 *
 * Every request verifies the work item belongs to the caller's client
 * before touching comments, so a client cannot read or post into another
 * client's task thread by guessing a uuid.
 */

import { requirePortalAuth } from "@/lib/portal/require-portal-auth"
import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

const MAX_COMMENT_LENGTH = 5000

/**
 * Confirms the work item exists AND belongs to this client.
 * Returns the work item id on success, or a NextResponse to bail with.
 */
async function assertOwnsWorkItem(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workItemId: string,
  clientId: string,
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const { data, error } = await supabase
    .from("work_items")
    .select("id")
    .eq("id", workItemId)
    .eq("client_key", clientId)
    .maybeSingle()

  if (error) {
    return {
      ok: false,
      response: NextResponse.json({ error: error.message }, { status: 500 }),
    }
  }
  if (!data) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not found" }, { status: 404 }),
    }
  }
  return { ok: true }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid work item id" }, { status: 400 })
  }

  const auth = await requirePortalAuth()
  if (!auth.ok) return auth.response

  const supabase = await createClient()
  const owns = await assertOwnsWorkItem(supabase, id, auth.portalUser.clientId)
  if (!owns.ok) return owns.response

  const { data, error } = await supabase
    .from("portal_task_comments")
    .select("id, author_role, author_name, body, created_at")
    .eq("work_item_id", id)
    .order("created_at", { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ comments: data ?? [] })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid work item id" }, { status: 400 })
  }

  const auth = await requirePortalAuth()
  if (!auth.ok) return auth.response

  const { portalUser } = auth

  let body: string
  try {
    const json = await req.json()
    body = typeof json?.body === "string" ? json.body.trim() : ""
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (!body) {
    return NextResponse.json({ error: "Comment cannot be empty" }, { status: 400 })
  }
  if (body.length > MAX_COMMENT_LENGTH) {
    return NextResponse.json(
      { error: `Comment too long — max ${MAX_COMMENT_LENGTH} characters.` },
      { status: 400 },
    )
  }

  const supabase = await createClient()
  const owns = await assertOwnsWorkItem(supabase, id, portalUser.clientId)
  if (!owns.ok) return owns.response

  // author_role is derived from the authenticated session, never from the
  // request body, so a client can't impersonate a team member.
  const { data, error } = await supabase
    .from("portal_task_comments")
    .insert({
      work_item_id: id,
      client_id: portalUser.clientId,
      author_role: "client",
      author_name: portalUser.fullName ?? portalUser.email,
      body,
    })
    .select("id, author_role, author_name, body, created_at")
    .single()

  if (error) {
    console.error("[v0] POST portal task comment failed:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ comment: data }, { status: 201 })
}
