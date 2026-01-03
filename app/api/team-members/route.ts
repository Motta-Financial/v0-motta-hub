import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const role = searchParams.get("role")
    const status = searchParams.get("status")

    let query = supabase.from("team_members").select("*").order("full_name", { ascending: true })

    if (role) {
      query = query.eq("role", role)
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
