import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET() {
  try {
    const supabase = await createClient()

    const { data: serviceLines, error } = await supabase
      .from("service_lines")
      .select("id, name, code, category, is_active")
      .eq("is_active", true)
      .order("display_order", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching service lines:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ serviceLines: serviceLines || [] })
  } catch (error: any) {
    console.error("[v0] Error in service-lines route:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
