import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const role = searchParams.get("role")
    const status = searchParams.get("status")

    const includeAll = searchParams.get("include_all") === "true"
    let query = supabase.from("team_members").select("*").order("full_name", { ascending: true })

    if (role) {
      query = query.eq("role", role)
    } else if (!includeAll) {
      // By default, exclude Company and Alumni roles from user-facing lists
      query = query.not("role", "eq", "Company").not("role", "eq", "Alumni")
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
