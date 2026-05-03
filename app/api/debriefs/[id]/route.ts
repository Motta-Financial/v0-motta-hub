import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = createAdminClient()
    const body = await request.json()

    // Whitelist of editable columns
    const updates: Record<string, any> = {}
    const allowedFields = [
      "team_member_id",
      "debrief_date",
      "debrief_type",
      "status",
      "notes",
      "follow_up_date",
      "tax_year",
      "filing_status",
      "adjusted_gross_income",
      "taxable_income",
      "has_schedule_c",
      "has_schedule_e",
    ]

    for (const field of allowedFields) {
      if (field in body) {
        updates[field] = body[field] === "" ? null : body[field]
      }
    }

    // If updating team_member_id, also update the cached team_member_name in action_items JSONB
    if (body.team_member_id) {
      const { data: tm } = await supabase
        .from("team_members")
        .select("full_name")
        .eq("id", body.team_member_id)
        .single()

      if (tm) {
        const { data: existing } = await supabase
          .from("debriefs")
          .select("action_items")
          .eq("id", id)
          .single()

        const existingActionItems = (existing?.action_items as any) || {}
        updates.action_items = {
          ...existingActionItems,
          team_member_name: tm.full_name,
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 })
    }

    const { data, error } = await supabase
      .from("debriefs")
      .update(updates)
      .eq("id", id)
      .select(
        `
        *,
        contact:contacts(full_name),
        organization:organizations(name),
        work_item:work_items(title, karbon_work_item_key),
        team_member:team_members!team_member_id(id, full_name, avatar_url, email),
        created_by:team_members!created_by_id(id, full_name)
      `,
      )
      .single()

    if (error) {
      console.error("[v0] PATCH debrief error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ debrief: data })
  } catch (err) {
    console.error("[v0] Failed to update debrief:", err)
    const message = err instanceof Error ? err.message : "Failed to update debrief"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = createAdminClient()

    const { error } = await supabase.from("debriefs").delete().eq("id", id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete debrief"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
