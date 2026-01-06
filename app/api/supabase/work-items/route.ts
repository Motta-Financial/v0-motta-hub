import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)

    // Get filter parameters
    const serviceLine = searchParams.get("serviceLine")
    const titleFilter = searchParams.get("titleFilter")
    const status = searchParams.get("status")
    const periodMonth = searchParams.get("periodMonth") // Format: "2024-01" for January 2024
    const periodYear = searchParams.get("periodYear")

    let query = supabase
      .from("work_items")
      .select(`
        id,
        karbon_work_item_key,
        title,
        description,
        status,
        workflow_status,
        work_type,
        priority,
        due_date,
        start_date,
        completed_date,
        period_start,
        period_end,
        tax_year,
        client_type,
        karbon_client_key,
        client_group_name,
        client_manager_name,
        client_partner_name,
        assignee_name,
        estimated_minutes,
        actual_minutes,
        budget_minutes,
        karbon_url,
        karbon_created_at,
        karbon_modified_at,
        contact_id,
        organization_id,
        client_group_id
      `)
      .order("karbon_modified_at", { ascending: false })

    if (titleFilter) {
      query = query.ilike("title", `%${titleFilter}%`)
    }

    if (status === "active") {
      query = query.not("status", "ilike", "%completed%").not("status", "ilike", "%cancelled%")
    } else if (status) {
      query = query.ilike("status", `%${status}%`)
    }

    if (periodMonth && periodYear) {
      const monthNum = Number.parseInt(periodMonth)
      const yearNum = Number.parseInt(periodYear)
      // Create date range for the month
      const startOfMonth = new Date(yearNum, monthNum - 1, 1).toISOString().split("T")[0]
      const endOfMonth = new Date(yearNum, monthNum, 0).toISOString().split("T")[0]

      query = query.gte("period_start", startOfMonth).lte("period_start", endOfMonth)
    } else if (periodYear) {
      // Filter by year only
      query = query.eq("tax_year", Number.parseInt(periodYear))
    }

    const { data: workItems, error } = await query.limit(500)

    if (error) {
      console.error("[v0] Supabase work_items error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Get related client info if needed
    const contactIds = [...new Set(workItems?.filter((w) => w.contact_id).map((w) => w.contact_id))]
    const orgIds = [...new Set(workItems?.filter((w) => w.organization_id).map((w) => w.organization_id))]

    let contacts: any[] = []
    let organizations: any[] = []

    if (contactIds.length > 0) {
      const { data } = await supabase
        .from("contacts")
        .select("id, full_name, primary_email, avatar_url, karbon_contact_key")
        .in("id", contactIds)
      contacts = data || []
    }

    if (orgIds.length > 0) {
      const { data } = await supabase
        .from("organizations")
        .select("id, name, primary_email, karbon_organization_key")
        .in("id", orgIds)
      organizations = data || []
    }

    // Create lookup maps
    const contactMap = new Map(contacts.map((c) => [c.id, c]))
    const orgMap = new Map(organizations.map((o) => [o.id, o]))

    // Enrich work items with client info
    const enrichedWorkItems = workItems?.map((item) => ({
      ...item,
      client: item.contact_id
        ? contactMap.get(item.contact_id)
        : item.organization_id
          ? orgMap.get(item.organization_id)
          : null,
      clientName: item.contact_id
        ? contactMap.get(item.contact_id)?.full_name
        : item.organization_id
          ? orgMap.get(item.organization_id)?.name
          : item.client_group_name || "Unknown Client",
    }))

    return NextResponse.json({
      workItems: enrichedWorkItems || [],
      total: enrichedWorkItems?.length || 0,
    })
  } catch (error) {
    console.error("[v0] Work items API error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch work items" },
      { status: 500 },
    )
  }
}
