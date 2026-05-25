import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * GET /api/team-members/tax-return-counts
 *
 * Returns tax-return counts per team_member, derived from
 *   team_members  ←→  proconnect_profiles.team_member_id
 *                 ←→  proconnect_engagements.assignee_profile_id
 *
 * Notes:
 * - A teammate is only countable when an admin has linked their
 *   `proconnect_profiles` row to the `team_members` row at
 *   /tax/settings (see `lib/tax/proconnect-profile-match.ts`).
 *   Unmapped profiles return 0, NOT a guess — never fabricate
 *   identity from an unmapped GUID (same rule as Tommy / preparer).
 * - Optional `?team_member_id=<uuid>` returns a single
 *   `{ team_member_id, total, by_year }` object instead of the full
 *   array. Used by the self-service profile page.
 * - Optional `?year=YYYY` filters all counts to one tax year.
 *
 * Response shape (no filter):
 *   {
 *     counts: [
 *       { team_member_id, total, by_year: { 2024: 12, 2025: 5 } }, ...
 *     ]
 *   }
 */
export async function GET(request: Request) {
  const supabase = createAdminClient()
  const { searchParams } = new URL(request.url)
  const teamMemberId = searchParams.get("team_member_id")
  const yearParam = searchParams.get("year")
  const year = yearParam ? Number.parseInt(yearParam, 10) : null

  // 1. Pull profile_id → team_member_id mapping. Profiles without a
  //    linked teammate are skipped entirely.
  let profileQuery = supabase
    .from("proconnect_profiles")
    .select("proconnect_profile_id, team_member_id")
    .not("team_member_id", "is", null)
  if (teamMemberId) {
    profileQuery = profileQuery.eq("team_member_id", teamMemberId)
  }
  const { data: profiles, error: profilesError } = await profileQuery
  if (profilesError) {
    console.error("[v0] tax-return-counts profiles error:", profilesError)
    return NextResponse.json({ error: profilesError.message }, { status: 500 })
  }

  const profileToTeammate = new Map<string, string>()
  for (const row of profiles || []) {
    if (row.team_member_id) {
      profileToTeammate.set(row.proconnect_profile_id, row.team_member_id)
    }
  }

  if (profileToTeammate.size === 0) {
    return NextResponse.json({
      counts: teamMemberId
        ? [{ team_member_id: teamMemberId, total: 0, by_year: {} }]
        : [],
    })
  }

  // 2. Pull engagement rows for the relevant profile IDs only. We page
  //    via .in() rather than scanning the whole table.
  let engagementQuery = supabase
    .from("proconnect_engagements")
    .select("assignee_profile_id, tax_year")
    .in("assignee_profile_id", [...profileToTeammate.keys()])
  if (year && Number.isFinite(year)) {
    engagementQuery = engagementQuery.eq("tax_year", year)
  }
  const { data: engagements, error: engagementsError } = await engagementQuery
  if (engagementsError) {
    console.error("[v0] tax-return-counts engagements error:", engagementsError)
    return NextResponse.json({ error: engagementsError.message }, { status: 500 })
  }

  // 3. Aggregate: total per teammate + breakdown by tax_year.
  type Bucket = { total: number; by_year: Record<string, number> }
  const buckets = new Map<string, Bucket>()
  for (const e of engagements || []) {
    const tmId = profileToTeammate.get(e.assignee_profile_id as string)
    if (!tmId) continue
    const bucket = buckets.get(tmId) ?? { total: 0, by_year: {} }
    bucket.total += 1
    if (e.tax_year != null) {
      const key = String(e.tax_year)
      bucket.by_year[key] = (bucket.by_year[key] ?? 0) + 1
    }
    buckets.set(tmId, bucket)
  }

  // Ensure every requested teammate appears even when count is 0 (so
  // the UI can render "0" rather than "—" for known-mapped people).
  for (const tmId of profileToTeammate.values()) {
    if (!buckets.has(tmId)) buckets.set(tmId, { total: 0, by_year: {} })
  }

  const counts = [...buckets.entries()].map(([team_member_id, b]) => ({
    team_member_id,
    total: b.total,
    by_year: b.by_year,
  }))

  return NextResponse.json({ counts })
}
