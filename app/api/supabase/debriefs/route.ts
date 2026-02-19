import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = Number.parseInt(searchParams.get("limit") || "20")
    const clientKey = searchParams.get("clientKey")

    const supabase = createAdminClient()

    // Query the debriefs_full view which already joins team_members,
    // contacts, organizations, and work_items via pre-built SQL view.
    let query = supabase
      .from("debriefs_full")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit)

    if (clientKey) {
      query = query.or(`karbon_client_key.eq.${clientKey},organization_name.ilike.%${clientKey}%`)
    }

    const { data, error } = await query

    if (error) {
      console.error("debriefs_full view error, falling back to base table:", error.message)

      // Fallback: query base debriefs table with FK joins (now that FKs exist)
      let fallback = supabase
        .from("debriefs")
        .select(`
          *,
          team_member_rel:team_members!debriefs_team_member_id_fkey(full_name, avatar_url),
          created_by_rel:team_members!debriefs_created_by_id_fkey(full_name, avatar_url),
          contact:contacts(full_name),
          organization:organizations(name),
          work_item:work_items(title, client_name, karbon_url)
        `)
        .order("created_at", { ascending: false })
        .limit(limit)

      if (clientKey) {
        fallback = fallback.or(`karbon_client_key.eq.${clientKey},organization_name.ilike.%${clientKey}%`)
      }

      const { data: fbData, error: fbError } = await fallback

      if (fbError) {
        return NextResponse.json({ error: fbError.message }, { status: 500 })
      }

      // Normalize the nested join objects to flat field names matching debriefs_full
      const normalized = (fbData || []).map((d: any) => ({
        ...d,
        team_member_full_name: d.team_member_rel?.full_name || null,
        team_member_avatar_url: d.team_member_rel?.avatar_url || null,
        created_by_full_name: d.created_by_rel?.full_name || null,
        created_by_avatar_url: d.created_by_rel?.avatar_url || null,
        contact_full_name: d.contact?.full_name || null,
        organization_display_name: d.organization?.name || null,
        work_item_title: d.work_item?.title || null,
        work_item_client_name: d.work_item?.client_name || null,
        work_item_karbon_url: d.work_item?.karbon_url || null,
      }))

      return NextResponse.json({ debriefs: normalized })
    }

    return NextResponse.json({ debriefs: data || [] })
  } catch (err) {
    console.error("Failed to fetch debriefs:", err)
    return NextResponse.json({ error: "Failed to fetch debriefs" }, { status: 500 })
  }
}
