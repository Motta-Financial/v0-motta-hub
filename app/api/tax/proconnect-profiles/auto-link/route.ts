/**
 * Bulk auto-link unmapped ProConnect profile GUIDs to team_members where
 * we have a high-confidence match (score >= 0.85, clear separation from
 * the second-best candidate). Inactive teammates are eligible because
 * historical preparers must keep their attribution.
 *
 * Operators can still manually adjust any single row from the Preparer
 * Mapping card afterward; this endpoint is just a "do the obvious ones
 * for me" shortcut.
 */
import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import {
  pickAutolinkCandidate,
  rankTeamMembers,
  type TeamMemberLite,
} from "@/lib/tax/proconnect-profile-match"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function POST(request: Request) {
  const supabase = getSupabase()

  let body: { dryRun?: boolean; overrideExisting?: boolean } = {}
  try {
    body = await request.json()
  } catch {
    // empty body is fine
  }
  const dryRun = body.dryRun === true
  const overrideExisting = body.overrideExisting === true

  const [{ data: profiles, error: pErr }, { data: teamMembers, error: tErr }] =
    await Promise.all([
      supabase
        .from("proconnect_profiles")
        .select(
          "proconnect_profile_id, full_name, email, notes, team_member_id",
        ),
      supabase
        .from("team_members")
        .select(
          "id, full_name, first_name, last_name, email, role, is_active",
        ),
    ])

  if (pErr || tErr) {
    return NextResponse.json(
      { error: pErr?.message || tErr?.message || "Failed to load data" },
      { status: 500 },
    )
  }

  const tmTyped: TeamMemberLite[] = (teamMembers || []).map((t) => ({
    id: (t as { id: string }).id,
    full_name: (t as { full_name: string | null }).full_name,
    first_name: (t as { first_name: string | null }).first_name ?? null,
    last_name: (t as { last_name: string | null }).last_name ?? null,
    email: (t as { email: string | null }).email,
    role: (t as { role: string | null }).role,
    is_active: (t as { is_active: boolean | null }).is_active ?? true,
  }))

  type Plan = {
    profileId: string
    teamMemberId: string
    teamMemberName: string
    score: number
    matchedOn: string[]
    isActive: boolean
    skippedReason?: string
  }
  const planned: Plan[] = []
  const skipped: Plan[] = []

  for (const p of profiles || []) {
    const ranked = rankTeamMembers(
      {
        profileId: (p as { proconnect_profile_id: string })
          .proconnect_profile_id,
        fullName: (p as { full_name: string | null }).full_name,
        email: (p as { email: string | null }).email,
        notes: (p as { notes: string | null }).notes,
      },
      tmTyped,
    )
    const top = pickAutolinkCandidate(ranked)
    const existing = (p as { team_member_id: string | null }).team_member_id
    const profileId = (p as { proconnect_profile_id: string })
      .proconnect_profile_id

    if (!top) continue
    if (existing && !overrideExisting) {
      skipped.push({
        profileId,
        teamMemberId: top.teamMemberId,
        teamMemberName: top.fullName,
        score: top.score,
        matchedOn: top.matchedOn,
        isActive: top.isActive,
        skippedReason: "already linked",
      })
      continue
    }
    planned.push({
      profileId,
      teamMemberId: top.teamMemberId,
      teamMemberName: top.fullName,
      score: top.score,
      matchedOn: top.matchedOn,
      isActive: top.isActive,
    })
  }

  if (dryRun || planned.length === 0) {
    return NextResponse.json({
      dryRun,
      planned,
      skipped,
      applied: 0,
    })
  }

  // Apply
  const now = new Date().toISOString()
  const errors: { profileId: string; error: string }[] = []
  for (const item of planned) {
    const { error } = await supabase
      .from("proconnect_profiles")
      .update({ team_member_id: item.teamMemberId, updated_at: now })
      .eq("proconnect_profile_id", item.profileId)
    if (error) errors.push({ profileId: item.profileId, error: error.message })
  }

  return NextResponse.json({
    dryRun: false,
    planned,
    skipped,
    applied: planned.length - errors.length,
    errors,
  })
}
