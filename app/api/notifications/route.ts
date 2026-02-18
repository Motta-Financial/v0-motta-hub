import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const teamMemberId = searchParams.get("team_member_id")
    const isRead = searchParams.get("is_read")
    const limit = Number.parseInt(searchParams.get("limit") || "50")

    let query = supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(limit)

    if (teamMemberId) {
      query = query.eq("team_member_id", teamMemberId)
    }
    if (isRead !== null && isRead !== undefined) {
      query = query.eq("is_read", isRead === "true")
    }

    const { data, error } = await query

    if (error) throw error

    return NextResponse.json(data || [])
  } catch (error) {
    console.error("Error fetching notifications:", error)
    return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()
    const { id, is_read }

    const { data, error } = await supabase
      .from("notifications")
      .update({ is_read, read_at: is_read ? new Date().toISOString() : null })
      .eq("id", id)
      .select()

    if (error) throw error

    return NextResponse.json(data[0])
  } catch (error) {
    console.error("Error updating notification:", error)
    return NextResponse.json({ error: "Failed to update notification" }, { status: 500 })
  }
}
