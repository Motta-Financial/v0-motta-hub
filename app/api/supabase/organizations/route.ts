import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const search = searchParams.get("search")
    const limit = Number.parseInt(searchParams.get("limit") || "50")
    const karbonKey = searchParams.get("karbon_key")

    let query = supabase
      .from("organizations")
      .select(
        "id, karbon_organization_key, name, entity_type, contact_type, industry, primary_email, phone, city, state",
      )
      .order("name", { ascending: true })
      .limit(limit)

    if (karbonKey) {
      query = query.eq("karbon_organization_key", karbonKey)
    }

    if (search) {
      query = query.ilike("name", `%${search}%`)
    }

    const { data: organizations, error } = await query

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
