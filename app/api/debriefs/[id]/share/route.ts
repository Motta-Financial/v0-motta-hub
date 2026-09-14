/**
 * POST /api/debriefs/[id]/share
 * Body: { clientSummary: string, shared: boolean }
 *
 * The staff control behind scripts/420: write the client-facing recap for
 * a debrief and choose whether the client sees it.
 *
 * Sharing is deliberately a two-part action — you cannot flip the flag
 * without supplying a summary (the DB enforces this too, via
 * debriefs_shared_requires_summary). That is what keeps internal notes
 * from reaching a client by a single mis-click.
 */
import { NextResponse, type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getTeamMemberByAuthId } from "@/lib/team-members"

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
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

    const teamMember = await getTeamMemberByAuthId(user.id, user.email)
    if (!teamMember) return NextResponse.json({ error: "Not a team member" }, { status: 403 })

    let clientSummary: string
    let shared: boolean
    try {
      const json = await request.json()
      clientSummary = (json?.clientSummary ?? "").trim()
      shared = json?.shared === true
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
    }

    if (shared && !clientSummary) {
      return NextResponse.json(
        { error: "Write a client-facing summary before sharing this meeting" },
        { status: 400 },
      )
    }

    const { data, error } = await supabase
      .from("debriefs")
      .update({
        client_summary: clientSummary || null,
        shared_with_client: shared,
        shared_at: shared ? new Date().toISOString() : null,
        shared_by_id: shared ? teamMember.id : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id, shared_with_client, shared_at")
      .single()

    if (error) throw error

    return NextResponse.json({ debrief: data })
  } catch (error) {
    console.error("Error sharing debrief:", error)
    return NextResponse.json({ error: "Failed to update sharing" }, { status: 500 })
  }
}
