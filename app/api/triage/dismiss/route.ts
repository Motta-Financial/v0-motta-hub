import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * POST /api/triage/dismiss
 * Body: { team_member_id, source_type, source_id }
 *
 * Records a per-user "I've cleared this" entry against an item from the
 * Triage feed. Idempotent: clicking Clear twice is a no-op (handled via
 * the unique constraint on (team_member_id, source_type, source_id)).
 *
 * Other users still see the item — dismissal is purely a personal view
 * state. The underlying message / debrief / meeting / etc. is untouched.
 */
export async function POST(request: Request) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()
    const { team_member_id, source_type, source_id } = body || {}

    if (!team_member_id || !source_type || !source_id) {
      return NextResponse.json(
        { error: "team_member_id, source_type, and source_id are required" },
        { status: 400 },
      )
    }

    const { error } = await supabase
      .from("triage_dismissals")
      .upsert(
        {
          team_member_id,
          source_type,
          source_id,
        },
        { onConflict: "team_member_id,source_type,source_id" },
      )

    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Error dismissing triage item:", error)
    return NextResponse.json({ error: "Failed to dismiss item" }, { status: 500 })
  }
}

/**
 * DELETE /api/triage/dismiss
 * Body: { team_member_id, source_type, source_id }
 *
 * Restores a previously-dismissed item to the user's feed. Used by the
 * "Undo" affordance after a single-item Clear so users can recover from
 * an accidental click without waiting for the Cmd-Z window.
 */
export async function DELETE(request: Request) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()
    const { team_member_id, source_type, source_id } = body || {}

    if (!team_member_id || !source_type || !source_id) {
      return NextResponse.json(
        { error: "team_member_id, source_type, and source_id are required" },
        { status: 400 },
      )
    }

    const { error } = await supabase
      .from("triage_dismissals")
      .delete()
      .eq("team_member_id", team_member_id)
      .eq("source_type", source_type)
      .eq("source_id", source_id)

    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Error restoring triage item:", error)
    return NextResponse.json({ error: "Failed to restore item" }, { status: 500 })
  }
}
