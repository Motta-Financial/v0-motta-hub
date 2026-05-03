import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const role = searchParams.get("role")
    const status = searchParams.get("status")

    // Default behavior:
    //   - exclude is_active=false members (Alumni / deactivated)
    //   - exclude system accounts ("Company" role: Motta Financial, Karbon HQ)
    // Pass ?include_all=true to bypass these filters (admin views).
    // Pass ?include_inactive=true to keep system accounts hidden but include
    // inactive humans (e.g. directory pages that show Active/Inactive tabs).
    const includeAll = searchParams.get("include_all") === "true"
    const includeInactive = includeAll || searchParams.get("include_inactive") === "true"

    let query = supabase.from("team_members").select("*").order("full_name", { ascending: true })

    if (role) {
      query = query.eq("role", role)
    } else if (!includeAll) {
      // System accounts (role='Company': Motta Financial, Karbon HQ) should
      // never appear in user-facing selectors regardless of is_active. We
      // explicitly OR in role.is.null so PostgREST doesn't drop NULL-role
      // rows due to SQL three-valued logic on `not.eq`.
      query = query.or("role.is.null,role.neq.Company")
    }
    if (!includeInactive) {
      query = query.eq("is_active", true)
    }
    if (status) {
      query = query.eq("status", status)
    }

    const { data: teamMembers, error } = await query

    if (error) throw error

    return NextResponse.json({ team_members: teamMembers || [] })
  } catch (error) {
    console.error("Error fetching team members:", error)
    return NextResponse.json({ error: "Failed to fetch team members" }, { status: 500 })
  }
}
