import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * Detail + triage actions for a single feedback submission.
 *
 *   GET    → full row including raw_answers, all referrals, prefill_metadata
 *   PATCH  → mutate triage state: triage_status, reviewed_by_id, internal_notes
 *
 * Patch-allowed fields are deliberately narrow — everything else is
 * sourced from Jotform and would be clobbered on the next webhook
 * delivery if the UI could write it.
 *
 * Setting `triage_status = 'reviewed'` (or anything other than 'new')
 * also stamps `reviewed_at` to now() so the table can sort by review
 * time without juggling a separate "did you press the button" column.
 * Going back to 'new' clears it.
 */

const ALLOWED_STATUSES = new Set(["new", "reviewed", "responded", "closed"])

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from("jotform_feedback_submissions")
      .select("*")
      .eq("id", id)
      .single()

    if (error) throw error
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 })

    let reviewedBy: { id: string; name: string; avatarUrl: string | null } | null = null
    if (data.reviewed_by_id) {
      const { data: m } = await supabase
        .from("team_members")
        .select("id, full_name, first_name, last_name, avatar_url")
        .eq("id", data.reviewed_by_id)
        .maybeSingle()
      if (m) {
        reviewedBy = {
          id: m.id,
          name: m.full_name || `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim(),
          avatarUrl: m.avatar_url ?? null,
        }
      }
    }

    return NextResponse.json({ submission: { ...data, reviewedBy } })
  } catch (err: any) {
    console.error("[v0] GET /api/jotform/feedback/[id] error:", err)
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const supabase = createAdminClient()

    const updates: Record<string, unknown> = {}

    if (body.triage_status !== undefined) {
      if (body.triage_status !== null && !ALLOWED_STATUSES.has(body.triage_status)) {
        return NextResponse.json(
          { error: `Invalid triage_status. Allowed: ${[...ALLOWED_STATUSES].join(", ")}` },
          { status: 400 },
        )
      }
      updates.triage_status = body.triage_status
      // Mirror reviewed_at on transitions out of / back into 'new'.
      // Cosmetic only — primarily so the table can show "Reviewed
      // 3 hours ago" without checking which column changed.
      updates.reviewed_at =
        body.triage_status && body.triage_status !== "new" ? new Date().toISOString() : null
    }
    if (body.reviewed_by_id !== undefined) {
      updates.reviewed_by_id = body.reviewed_by_id || null
    }
    if (body.internal_notes !== undefined) {
      updates.internal_notes = body.internal_notes
    }
    if (body.karbon_work_item_id !== undefined) {
      updates.karbon_work_item_id = body.karbon_work_item_id || null
    }
    if (body.karbon_work_item_title !== undefined) {
      updates.karbon_work_item_title = body.karbon_work_item_title || null
    }
    if (body.karbon_work_item_url !== undefined) {
      updates.karbon_work_item_url = body.karbon_work_item_url || null
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No updatable fields supplied" }, { status: 400 })
    }

    const { data, error } = await supabase
      .from("jotform_feedback_submissions")
      .update(updates)
      .eq("id", id)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ submission: data })
  } catch (err: any) {
    console.error("[v0] PATCH /api/jotform/feedback/[id] error:", err)
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 })
  }
}
