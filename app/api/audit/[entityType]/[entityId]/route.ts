/**
 * GET /api/audit/[entityType]/[entityId]
 *
 * Returns the change history (audit trail) for a single entity, newest
 * first, joined with the acting team member's name + avatar.
 *
 *   { changes: AuditEntry[] }
 *
 * Limited to the 100 most recent entries.
 */

import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

const VALID_ENTITY_TYPES = new Set(["contact", "organization", "deal", "project"])

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ entityType: string; entityId: string }> },
) {
  try {
    const { entityType, entityId } = await params

    if (!VALID_ENTITY_TYPES.has(entityType)) {
      return NextResponse.json({ error: `Invalid entity type: ${entityType}` }, { status: 400 })
    }

    const supabase = createAdminClient()

    const { data: rows, error } = await supabase
      .from("activity_log")
      .select("id, entity_type, entity_id, action, description, changes, metadata, created_at, team_member_id")
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .order("created_at", { ascending: false })
      .limit(100)

    if (error) {
      console.error("[v0] GET /api/audit error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Resolve actor names/avatars in one query.
    const memberIds = Array.from(
      new Set((rows ?? []).map((r) => r.team_member_id).filter(Boolean)),
    ) as string[]

    const memberById = new Map<string, { full_name: string | null; avatar_url: string | null }>()
    if (memberIds.length > 0) {
      const { data: members } = await supabase
        .from("team_members")
        .select("id, full_name, avatar_url")
        .in("id", memberIds)
      for (const m of members ?? []) {
        memberById.set(m.id, { full_name: m.full_name, avatar_url: m.avatar_url })
      }
    }

    const changes = (rows ?? []).map((r) => {
      const member = r.team_member_id ? memberById.get(r.team_member_id) : null
      return {
        id: r.id,
        action: r.action,
        description: r.description,
        changes: r.changes ?? {},
        metadata: r.metadata ?? null,
        created_at: r.created_at,
        actor_name: member?.full_name ?? null,
        actor_avatar_url: member?.avatar_url ?? null,
      }
    })

    return NextResponse.json({ changes })
  } catch (err) {
    console.error("[v0] GET /api/audit unexpected error:", err)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
