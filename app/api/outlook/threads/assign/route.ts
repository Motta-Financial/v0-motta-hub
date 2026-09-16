/**
 * Attach an Outlook thread to a work item, or detach it.
 *
 *   POST   { conversationId, workItemId }  → file the thread
 *   DELETE { conversationId }              → unfile it
 *
 * Filings are firm-wide, not per-mailbox (scripts/426): a conversation id
 * is stable across mailboxes in the tenant, so when one person files a
 * thread everyone sees it there. That is the point -- "everything in one
 * place" fails if each person files the same email separately.
 *
 * No email content is stored. This writes a pointer and nothing else; the
 * thread stays in Outlook.
 */
import { NextResponse, type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers"

async function requireTeamMember(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await getAuthenticatedUser(supabase)
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) }

  const { data: teamMember } = await supabase
    .from("team_members")
    .select("id")
    .eq("auth_user_id", user.id)
    .single()
  if (!teamMember) {
    return { error: NextResponse.json({ error: "Team member not found" }, { status: 404 }) }
  }
  return { teamMember }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireTeamMember(supabase)
    if ("error" in auth) return auth.error

    let conversationId: string
    let workItemId: string
    try {
      const json = await request.json()
      conversationId = (json?.conversationId ?? "").trim()
      workItemId = (json?.workItemId ?? "").trim()
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
    }

    if (!conversationId || !workItemId) {
      return NextResponse.json(
        { error: "conversationId and workItemId are required" },
        { status: 400 },
      )
    }

    // Read the work item back rather than trusting the id from the client.
    // It gives us the client to denormalise, and it means a stale dropdown
    // cannot file a thread against a work item that no longer exists.
    const { data: workItem } = await supabase
      .from("work_items")
      .select("id, title, contact_id, organization_id")
      .eq("id", workItemId)
      .maybeSingle()

    if (!workItem) {
      return NextResponse.json({ error: "That project no longer exists" }, { status: 404 })
    }

    // Re-filing a thread moves it rather than erroring -- changing your
    // mind about which job an email belongs to is normal.
    const { data, error } = await supabase
      .from("email_thread_assignments")
      .upsert(
        {
          conversation_id: conversationId,
          work_item_id: workItem.id,
          assigned_by_id: auth.teamMember.id,
          contact_id: workItem.contact_id,
          organization_id: workItem.organization_id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "conversation_id" },
      )
      .select("conversation_id, work_item_id, assigned_by_id, created_at")
      .single()

    if (error) throw error

    return NextResponse.json({
      assignment: {
        workItemId: data.work_item_id,
        workItemTitle: workItem.title,
        assignedById: data.assigned_by_id,
        assignedAt: data.created_at,
      },
    })
  } catch (err) {
    console.error("[outlook] thread assign error:", err)
    return NextResponse.json({ error: "Could not assign that thread" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireTeamMember(supabase)
    if ("error" in auth) return auth.error

    const conversationId = request.nextUrl.searchParams.get("conversationId")?.trim()
    if (!conversationId) {
      return NextResponse.json({ error: "conversationId is required" }, { status: 400 })
    }

    const { error } = await supabase
      .from("email_thread_assignments")
      .delete()
      .eq("conversation_id", conversationId)

    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[outlook] thread unassign error:", err)
    return NextResponse.json({ error: "Could not unassign that thread" }, { status: 500 })
  }
}
