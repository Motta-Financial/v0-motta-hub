import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    console.log("[v0] Profile update request body:", JSON.stringify(body))

    const {
      teamMemberId,
      first_name,
      last_name,
      full_name,
      email,
      phone_number,
      mobile_number,
      title,
      department,
      timezone,
    } = body

    if (!teamMemberId) {
      console.log("[v0] Missing teamMemberId in request")
      return NextResponse.json({ error: "Team member ID is required" }, { status: 400 })
    }

    const updateData = {
      first_name,
      last_name,
      full_name,
      email,
      phone_number,
      mobile_number,
      title,
      department,
      timezone,
      updated_at: new Date().toISOString(),
    }
    console.log("[v0] Updating team_members with:", JSON.stringify(updateData))

    // Update team_members table
    const { data, error } = await supabaseAdmin
      .from("team_members")
      .update(updateData)
      .eq("id", teamMemberId)
      .select()
      .single()

    if (error) {
      console.log("[v0] Supabase update error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    console.log("[v0] Profile updated successfully:", JSON.stringify(data))
    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.log("[v0] Profile update exception:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update profile" },
      { status: 500 },
    )
  }
}
