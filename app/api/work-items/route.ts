import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const status = searchParams.get("status")
    const assignee = searchParams.get("assignee")
    const clientId = searchParams.get("clientId")
    const workType = searchParams.get("workType")
    const search = searchParams.get("search")
    const active = searchParams.get("active")
    const limit = Math.min(Number.parseInt(searchParams.get("limit") || "100"), 5000)
    const offset = Number.parseInt(searchParams.get("offset") || "0")

    // For large requests (dashboards), use a leaner select from the base table
    // to avoid Supabase's 1000-row default and reduce payload size.
    // For normal requests, use work_items_enriched view which pre-joins
    // contacts, organizations, client_groups, and team_members.
    const isLargeRequest = limit > 1000

    let query = supabase
      .from(isLargeRequest ? "work_items" : "work_items_enriched")
      .select(
        isLargeRequest
          ? `id, karbon_work_item_key, title, client_name, karbon_client_key,
             client_group_name, status, primary_status, secondary_status,
             workflow_status, work_type, due_date, start_date, completed_date,
             assignee_name, priority, karbon_modified_at, karbon_url, description`
          : "*",
        { count: "exact" },
      )
      .order("due_date", { ascending: true, nullsFirst: false })
      .range(offset, offset + limit - 1)

    if (status) {
      query = query.eq("workflow_status", status)
    }
    if (assignee) {
      query = query.eq("assignee_key", assignee)
    }
    if (clientId) {
      query = query.or(`contact_id.eq.${clientId},organization_id.eq.${clientId}`)
    }
    if (workType) {
      query = query.eq("work_type", workType)
    }
    if (search) {
      query = query.or(
        `title.ilike.%${search}%,client_name.ilike.%${search}%,work_type.ilike.%${search}%,karbon_work_item_key.ilike.%${search}%`
      )
    }
    if (active === "true") {
      query = query
        .not("status", "ilike", "%completed%")
        .not("status", "ilike", "%cancelled%")
        .not("status", "ilike", "%canceled%")
    }

    const { data: workItems, error, count } = await query

    if (error) throw error

    // Transform to include client info using enriched view flat fields
    const formattedItems = (workItems || []).map((item: any) => ({
      ...item,
      client_name: item.client_name || item.contact_full_name || item.org_name || item.client_type,
      client_email: item.contact_email || item.org_email,
    }))

    return NextResponse.json({
      work_items: formattedItems,
      total: count || formattedItems.length,
      limit,
      offset,
    })
  } catch (error) {
    console.error("Error fetching work items:", error)
    return NextResponse.json({ error: "Failed to fetch work items" }, { status: 500 })
  }
}
