import { createClient, isSupabaseConfigured } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export async function GET() {
  try {
    // Check if Supabase is configured
    if (!isSupabaseConfigured()) {
      // Return mock data for development when Supabase is not configured
      return NextResponse.json({
        user: null,
        teamMember: null,
        configured: false,
      })
    }

    const supabase = await createClient()

    if (!supabase) {
      return NextResponse.json({ user: null, teamMember: null, configured: false })
    }

    // Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ user: null, teamMember: null, configured: true })
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

    return NextResponse.json({ user, teamMember, configured: true })
  } catch (error) {
    console.error("Error fetching user:", error)
    return NextResponse.json({ user: null, teamMember: null, configured: true })
  }
}
