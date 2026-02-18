import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const search = searchParams.get("search")
    const limit = Number.parseInt(searchParams.get("limit") || "50")
    const entityType = searchParams.get("entity_type")
    const isProspect = searchParams.get("is_prospect")
    const karbonKey = searchParams.get("karbon_key")

    let query = supabase
      .from("contacts")
      .select(
        "id, karbon_contact_key, full_name, first_name, last_name, preferred_name, entity_type, contact_type, primary_email, phone_primary, city, state, is_prospect, avatar_url",
      )
      .order("full_name", { ascending: true })
      .limit(limit)

    if (karbonKey) {
      query = query.eq("karbon_contact_key", karbonKey)
    }

    if (search) {
      query = query.or(
        `full_name.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%,preferred_name.ilike.%${search}%,primary_email.ilike.%${search}%`,
      )
    }

    if (entityType) {
      query = query.eq("entity_type", entityType)
    }

    if (isProspect === "true") {
      query = query.eq("is_prospect", true)
    } else if (isProspect === "false") {
      query = query.eq("is_prospect", false)
    }

    const { data: contacts, error } = await query

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
