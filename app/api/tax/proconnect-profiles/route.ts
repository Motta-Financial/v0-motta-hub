import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

/**
 * GET /api/tax/proconnect-profiles
 *
 * Returns all 13 ProConnect profile rows joined with their team_member,
 * the engagement count attributed to each (so the operator can prioritise
 * which GUIDs to map first), and the full team_members roster so the UI
 * can render a dropdown for linking.
 */
export async function GET() {
  const supabase = getSupabase()

  const [{ data: profiles }, { data: teamMembers }] = await Promise.all([
    supabase
      .from("proconnect_profiles")
      .select(
        "proconnect_profile_id, proconnect_auth_id, full_name, email, team_member_id, is_active, notes, updated_at, team_members(id, full_name, email, role)"
      )
      .order("proconnect_profile_id"),
    supabase
      .from("team_members")
      .select("id, full_name, email, role")
      .order("full_name"),
  ])

  // Engagement attribution counts (so operator sees which IDs are highest-leverage)
  const { data: counts } = await supabase
    .from("proconnect_engagements")
    .select("assignee_profile_id")
    .not("assignee_profile_id", "is", null)

  const countByProfile: Record<string, number> = {}
  for (const row of counts || []) {
    const id = (row as { assignee_profile_id: string }).assignee_profile_id
    countByProfile[id] = (countByProfile[id] || 0) + 1
  }

  const enriched = (profiles || []).map((p) => ({
    profileId: p.proconnect_profile_id,
    authId: p.proconnect_auth_id,
    fullName:
      (p.team_members as { full_name?: string } | null)?.full_name ||
      p.full_name ||
      null,
    email:
      (p.team_members as { email?: string } | null)?.email || p.email || null,
    teamMemberId: p.team_member_id,
    teamMemberRole:
      (p.team_members as { role?: string } | null)?.role || null,
    engagementCount: countByProfile[p.proconnect_profile_id] || 0,
    isActive: p.is_active,
    notes: p.notes,
    updatedAt: p.updated_at,
  }))

  return NextResponse.json({
    profiles: enriched,
    teamMembers: teamMembers || [],
    unmappedCount: enriched.filter((p) => !p.fullName).length,
  })
}

/**
 * PATCH /api/tax/proconnect-profiles
 * Body: { profileId: string, teamMemberId: string | null, fullName?: string, notes?: string }
 *
 * Links a ProConnect profile GUID to a Motta team member. When teamMemberId
 * is null, the row is unlinked (full_name is preserved as a snapshot fallback).
 * The enriched view then COALESCEs preparer_name from team_members → fallback.
 */
export async function PATCH(request: Request) {
  const supabase = getSupabase()

  let body: {
    profileId?: string
    teamMemberId?: string | null
    fullName?: string | null
    notes?: string | null
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (!body.profileId) {
    return NextResponse.json(
      { error: "profileId is required" },
      { status: 400 }
    )
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }
  if ("teamMemberId" in body) updates.team_member_id = body.teamMemberId
  if ("fullName" in body) updates.full_name = body.fullName
  if ("notes" in body) updates.notes = body.notes

  const { data, error } = await supabase
    .from("proconnect_profiles")
    .update(updates)
    .eq("proconnect_profile_id", body.profileId)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, profile: data })
}
