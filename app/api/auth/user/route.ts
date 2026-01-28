import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export async function GET() {
  try {
    const supabase = await createClient()

    // Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ user: null, teamMember: null })
    }

    // Fetch team member data
    const { data: teamMember } = await supabase
      .from("team_members")
      .select("*")
      .or(`auth_user_id.eq.${user.id},email.eq.${user.email}`)
      .single()

    // Link auth_user_id if found by email but not linked yet
    if (teamMember && !teamMember.auth_user_id && teamMember.email === user.email) {
      await supabase.from("team_members").update({ auth_user_id: user.id }).eq("id", teamMember.id)
    }

    return NextResponse.json({ user, teamMember })
  } catch (error) {
    console.error("Error fetching user:", error)
    return NextResponse.json({ user: null, teamMember: null })
  }
}
