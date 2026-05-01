/**
 * GET /api/supabase/contacts
 *
 * Returns every contact synced from Karbon. Pages through the PostgREST
 * default `max-rows` cap (typically 1,000) so the Clients page can display
 * the full list (Motta currently has ~1,200 contacts).
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
    const entityType = searchParams.get("entity_type")
    const isProspect = searchParams.get("is_prospect")
    const karbonKey = searchParams.get("karbon_key")

    const cols =
      "id, karbon_contact_key, full_name, first_name, last_name, preferred_name, entity_type, contact_type, primary_email, phone_primary, city, state, is_prospect, avatar_url"

    // Single short-circuit lookup
    if (karbonKey) {
      const { data, error } = await supabase
        .from("contacts")
        .select(cols)
        .eq("karbon_contact_key", karbonKey)
        .limit(1)
      if (error) {
        console.error("[v0] Error fetching contact by key:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      return NextResponse.json({ contacts: data || [] })
    }

    // Build the base query (without range) so each page applies same filters
    const buildQuery = (from: number, to: number) => {
      let q = supabase
        .from("contacts")
        .select(cols)
        .order("full_name", { ascending: true })
        .range(from, to)

      if (search) {
        q = q.or(
          `full_name.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%,preferred_name.ilike.%${search}%,primary_email.ilike.%${search}%`,
        )
      }
      if (entityType) q = q.eq("entity_type", entityType)
      if (isProspect === "true") q = q.eq("is_prospect", true)
      else if (isProspect === "false") q = q.eq("is_prospect", false)
      return q
    }

    const collected: any[] = []
    let from = 0
    while (collected.length < limit) {
      const to = Math.min(from + PAGE_SIZE - 1, limit - 1)
      const { data, error } = await buildQuery(from, to)
      if (error) {
        console.error("[v0] Error fetching contacts:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      if (!data || data.length === 0) break
      collected.push(...data)
      if (data.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }

    return NextResponse.json({ contacts: collected })
  } catch (error: any) {
    console.error("[v0] Error in contacts route:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
