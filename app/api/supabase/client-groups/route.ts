import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET() {
  try {
    const supabase = await createClient()

    const { data: clientGroups, error } = await supabase
      .from("client_groups")
      .select("id, karbon_client_group_key, name, group_type")
      .order("name", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching client groups:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ clientGroups: clientGroups || [] })
  } catch (error: any) {
    console.error("[v0] Error in client-groups route:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
