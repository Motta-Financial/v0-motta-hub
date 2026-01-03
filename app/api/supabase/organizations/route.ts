import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET() {
  try {
    const supabase = await createClient()

    const { data: organizations, error } = await supabase
      .from("organizations")
      .select(
        "id, karbon_organization_key, name, entity_type, contact_type, industry, primary_email, phone, city, state",
      )
      .order("name", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching organizations:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ organizations: organizations || [] })
  } catch (error: any) {
    console.error("[v0] Error in organizations route:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
