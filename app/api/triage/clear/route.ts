import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * POST /api/triage/clear
 * Body: { team_member_id, items: [{ source_type, source_id }, ...] }
 *
 * Bulk-dismisses a batch of items in one round-trip. The client passes
 * the full list of currently-visible item identifiers when the user hits
 * "Clear All" — this avoids the server having to re-derive the same feed
 * to know what to clear, and means the operation is consistent with what
 * the user actually saw on screen at the moment they clicked.
 *
 * Idempotent: previously-dismissed items collide on the unique constraint
 * and are silently skipped via upsert.
 */
export async function POST(request: Request) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()
    const { team_member_id, items } = body || {}

    if (!team_member_id || !Array.isArray(items)) {
      return NextResponse.json(
        { error: "team_member_id and items[] are required" },
        { status: 400 },
      )
    }
    if (items.length === 0) {
      return NextResponse.json({ ok: true, dismissed: 0 })
    }

    // Cap at 500 per request — well above any realistic feed size, but
    // bounded in case a buggy client sends a runaway list.
    const rows = items.slice(0, 500).map((it: { source_type: string; source_id: string }) => ({
      team_member_id,
      source_type: it.source_type,
      source_id: it.source_id,
    }))

    const { error } = await supabase
      .from("triage_dismissals")
      .upsert(rows, { onConflict: "team_member_id,source_type,source_id" })

    if (error) throw error
    return NextResponse.json({ ok: true, dismissed: rows.length })
  } catch (error) {
    console.error("Error clearing triage feed:", error)
    return NextResponse.json({ error: "Failed to clear feed" }, { status: 500 })
  }
}
