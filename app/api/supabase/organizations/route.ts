/**
 * GET /api/supabase/organizations
 *
 * Returns every organization synced from Karbon. Uses the admin client to
 * bypass RLS (this is internal staff-only data) and pages through the
 * PostgREST default `max-rows` cap (typically 1,000) so the Clients page
 * can display the full list.
 */
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

const PAGE_SIZE = 1000

export async function GET(request: Request) {
  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const search = searchParams.get("search")
    const limit = Number.parseInt(searchParams.get("limit") || "10000")
    const karbonKey = searchParams.get("karbon_key")

    const cols =
      "id, karbon_organization_key, name, full_name, trading_name, legal_name, entity_type, contact_type, industry, primary_email, phone, city, state"

    // Single short-circuit lookup
    if (karbonKey) {
      const { data, error } = await supabase
        .from("organizations")
        .select(cols)
        .eq("karbon_organization_key", karbonKey)
        .limit(1)
      if (error) {
        console.error("[v0] Error fetching organization by key:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      return NextResponse.json({ organizations: data || [] })
    }

    // Page through results so we can return the entire list (PostgREST defaults
    // to 1,000 rows max per request on Supabase Cloud).
    const collected: any[] = []
    let from = 0
    while (collected.length < limit) {
      const to = Math.min(from + PAGE_SIZE - 1, limit - 1)
      let query = supabase
        .from("organizations")
        .select(cols)
        .order("name", { ascending: true })
        .range(from, to)

      if (search) {
        query = query.or(
          `name.ilike.%${search}%,full_name.ilike.%${search}%,trading_name.ilike.%${search}%,legal_name.ilike.%${search}%,primary_email.ilike.%${search}%`,
        )
      }

      const { data, error } = await query
      if (error) {
        console.error("[v0] Error fetching organizations:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      if (!data || data.length === 0) break
      collected.push(...data)
      if (data.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }

    return NextResponse.json({ organizations: collected })
  } catch (error: any) {
    console.error("[v0] Error in organizations route:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
