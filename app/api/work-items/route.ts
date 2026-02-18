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
    const limit = Math.min(Number.parseInt(searchParams.get("limit") || "100"), 5000)
    const offset = Number.parseInt(searchParams.get("offset") || "0")

    // For large requests (dashboards), use a leaner select to avoid
    // Supabase's 1000-row default and reduce payload size
    const isLargeRequest = limit > 1000

    let query = supabase
      .from("work_items")
      .select(
        isLargeRequest
          ? `id, karbon_work_item_key, title, client_name, karbon_client_key,
             client_group_name, status, primary_status, secondary_status,
             workflow_status, work_type, due_date, start_date, completed_date,
             assignee_name, priority, karbon_modified_at, karbon_url, description`
          : `*, contacts:contact_id (id, full_name, primary_email, karbon_url),
             organizations:organization_id (id, name, primary_email, karbon_url)`,
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
      query = query.ilike("title", `%${search}%`)
    }

    const { data: workItems, error, count } = await query

    if (error) throw error

    // Transform to include client info (only for non-large requests with joins)
    const formattedItems = (workItems || []).map((item: any) => ({
      ...item,
      client_name: item.client_name || item.contacts?.full_name || item.organizations?.name || item.client_type,
      client_email: item.contacts?.primary_email || item.organizations?.primary_email,
      client_karbon_url: item.contacts?.karbon_url || item.organizations?.karbon_url,
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
