import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = Number.parseInt(searchParams.get("limit") || "20")
    const clientKey = searchParams.get("clientKey")

    const supabase = createAdminClient()

    let query = supabase
      .from("debriefs")
      .select(`
        *,
        contact:contacts(full_name),
        organization:organizations(name),
        work_item:work_items(title, client_name),
        team_member_profile:team_members!debriefs_team_member_id_fkey(full_name, avatar_url),
        created_by_profile:team_members!debriefs_created_by_id_fkey(full_name, avatar_url)
      `)
      .order("created_at", { ascending: false })
      .limit(limit)

    // Filter by client key if provided
    if (clientKey) {
      query = query.or(`karbon_client_key.eq.${clientKey},organization_name.ilike.%${clientKey}%`)
    }

    const { data, error } = await query

    if (error) {
      console.error("Supabase debriefs error:", error)
      // Fallback: query without FK hints and manually resolve team member names
      const fallbackQuery = supabase
        .from("debriefs")
        .select(`
          *,
          contact:contacts(full_name),
          organization:organizations(name),
          work_item:work_items(title, client_name)
        `)
        .order("created_at", { ascending: false })
        .limit(limit)

      const { data: fallbackData, error: fallbackError } = await fallbackQuery

      if (fallbackError) {
        return NextResponse.json({ error: fallbackError.message }, { status: 500 })
      }

      // Manually look up team member names for the fallback data
      if (fallbackData && fallbackData.length > 0) {
        const teamMemberIds = [
          ...new Set(
            fallbackData
              .flatMap((d: any) => [d.team_member_id, d.created_by_id])
              .filter(Boolean)
          ),
        ]

        if (teamMemberIds.length > 0) {
          const { data: members } = await supabase
            .from("team_members")
            .select("id, full_name, avatar_url")
            .in("id", teamMemberIds)

          const memberMap = new Map(
            (members || []).map((m: any) => [m.id, { full_name: m.full_name, avatar_url: m.avatar_url }])
          )

          for (const debrief of fallbackData as any[]) {
            debrief.team_member_profile = memberMap.get(debrief.team_member_id) || null
            debrief.created_by_profile = memberMap.get(debrief.created_by_id) || null
          }
        }
      }

      return NextResponse.json({ debriefs: fallbackData || [] })
    }

    return NextResponse.json({ debriefs: data || [] })
  } catch (err) {
    console.error("Failed to fetch debriefs:", err)
    return NextResponse.json({ error: "Failed to fetch debriefs" }, { status: 500 })
  }
}
