import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function POST(request: NextRequest) {
  try {
    const { teamMemberId } = await request.json()

    if (!teamMemberId) {
      return NextResponse.json({ error: "Team member ID required" }, { status: 400 })
    }

    const supabase = await createClient()

    // Delete the connection
    const { error } = await supabase.from("calendly_connections").delete().eq("team_member_id", teamMemberId)

    if (error) {
      console.error("Failed to disconnect:", error)
      return NextResponse.json({ error: "Failed to disconnect" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Disconnect error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
