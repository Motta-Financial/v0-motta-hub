import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET() {
  try {
    const supabase = await createClient()

    const { data: contacts, error } = await supabase
      .from("contacts")
      .select(
        "id, karbon_contact_key, full_name, first_name, last_name, entity_type, contact_type, primary_email, phone_primary, city, state, is_prospect",
      )
      .order("full_name", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching contacts:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ contacts: contacts || [] })
  } catch (error: any) {
    console.error("[v0] Error in contacts route:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
