import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers"

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Verify the calling user is authenticated. Uses the local
    // JWT-signature check (see lib/supabase/auth-helpers.ts) rather
    // than a GoTrue network round-trip — this endpoint is part of the
    // dashboard hot path and a `getUser()` here was a key contributor
    // to the per-IP auth rate-limit trips.
    const {
      data: { user },
      error: authError,
    } = await getAuthenticatedUser(supabase)

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()

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
      return NextResponse.json({ error: "Team member ID is required" }, { status: 400 })
    }

    // Verify the user is updating their own profile
    const { data: teamMember } = await supabase
      .from("team_members")
      .select("id, auth_user_id")
      .eq("id", teamMemberId)
      .single()

    if (!teamMember || teamMember.auth_user_id !== user.id) {
      return NextResponse.json({ error: "You can only update your own profile" }, { status: 403 })
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

    // Update team_members table
    const { data, error } = await supabase
      .from("team_members")
      .update(updateData)
      .eq("id", teamMemberId)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error("Profile update error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update profile" },
      { status: 500 },
    )
  }
}
