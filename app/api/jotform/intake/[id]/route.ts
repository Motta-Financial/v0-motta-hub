import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * Detail + triage actions for a single intake submission.
 *
 *   GET    → full row including `raw_answers` (every Jotform Q/A pair)
 *   PATCH  → mutate triage state: lead_status, assigned_to_id, triage_notes
 *
 * Both use the admin client because intake submissions are firm-wide
 * operational data and any staff member needs to be able to read /
 * triage them. Only the three triage columns are PATCH-able; everything
 * else is sourced from Jotform and would be overwritten on the next
 * submission update if we let the UI mutate it.
 */

const ALLOWED_STATUSES = new Set([
  "new",
  "contacted",
  "qualified",
  "converted",
  "declined",
])

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from("jotform_intake_submissions")
      .select("*")
      .eq("id", id)
      .single()

    if (error) throw error
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 })

    let assignedTo: { id: string; name: string; avatarUrl: string | null } | null = null
    if (data.assigned_to_id) {
      const { data: m } = await supabase
        .from("team_members")
        .select("id, full_name, first_name, last_name, avatar_url")
        .eq("id", data.assigned_to_id)
        .maybeSingle()
      if (m) {
        assignedTo = {
          id: m.id,
          name: m.full_name || `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim(),
          avatarUrl: m.avatar_url ?? null,
        }
      }
    }

    return NextResponse.json({ submission: { ...data, assignedTo } })
  } catch (err: any) {
    console.error("[v0] GET /api/jotform/intake/[id] error:", err)
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const supabase = createAdminClient()

    const updates: Record<string, unknown> = {}

    if (body.lead_status !== undefined) {
      if (body.lead_status !== null && !ALLOWED_STATUSES.has(body.lead_status)) {
        return NextResponse.json(
          { error: `Invalid lead_status. Allowed: ${[...ALLOWED_STATUSES].join(", ")}` },
          { status: 400 },
        )
      }
      updates.lead_status = body.lead_status
    }
    if (body.assigned_to_id !== undefined) {
      updates.assigned_to_id = body.assigned_to_id || null
    }
    if (body.triage_notes !== undefined) {
      updates.triage_notes = body.triage_notes
    }
    if (body.action_items !== undefined) {
      // Action items from the triage sheet — store as JSONB
      updates.action_items = body.action_items
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No updatable fields supplied" }, { status: 400 })
    }

    const { data, error } = await supabase
      .from("jotform_intake_submissions")
      .update(updates)
      .eq("id", id)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ submission: data })
  } catch (err: any) {
    console.error("[v0] PATCH /api/jotform/intake/[id] error:", err)
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 })
  }
}
