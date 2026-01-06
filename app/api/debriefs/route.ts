import { createClient } from "@supabase/supabase-js"
import { type NextRequest, NextResponse } from "next/server"

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const clientKey = searchParams.get("clientKey")
  const contactId = searchParams.get("contactId")
  const organizationId = searchParams.get("organizationId")
  const limit = Number.parseInt(searchParams.get("limit") || "50")

  let query = supabase.from("debriefs").select("*").order("debrief_date", { ascending: false }).limit(limit)

  // Filter by contact or organization UUID
  if (contactId) {
    query = query.eq("contact_id", contactId)
  } else if (organizationId) {
    query = query.eq("organization_id", organizationId)
  } else if (clientKey) {
    query = query.or(`karbon_client_key.eq.${clientKey},organization_name.ilike.%${clientKey}%`)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ debriefs: data })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Extract core debrief fields that map to the table
    const debriefData: Record<string, any> = {
      debrief_date: body.debrief_date,
      notes: body.notes || null,
      follow_up_date: body.follow_up_date || null,
      team_member: body.team_member || null,
      created_by_id: body.created_by_id || null,
      contact_id: body.contact_id || null,
      organization_id: body.organization_id || null,
      work_item_id: body.work_item_id || null,
      karbon_work_url: body.karbon_work_url || null,
      status: body.status || "completed",
      debrief_type: body.debrief_type || "meeting",
    }

    // Store additional data in action_items JSON field
    if (
      body.action_items ||
      body.related_clients ||
      body.related_work_items ||
      body.service_lines ||
      body.research_topics ||
      body.fee_adjustments
    ) {
      debriefData.action_items = {
        items: body.action_items || [],
        related_clients: body.related_clients || [],
        related_work_items: body.related_work_items || [],
        service_lines: body.service_lines || [],
        research_topics: body.research_topics || [],
        fee_adjustments: body.fee_adjustments || null,
        notify_team: body.notify_team || false,
        notification_recipients: body.notification_recipients || [],
      }
    }

    // Get client names for display
    if (body.contact_id) {
      const { data: contact } = await supabase
        .from("contacts")
        .select("full_name, karbon_contact_key")
        .eq("id", body.contact_id)
        .single()

      if (contact) {
        debriefData.karbon_client_key = contact.karbon_contact_key
      }
    }

    if (body.organization_id) {
      const { data: org } = await supabase
        .from("organizations")
        .select("name, karbon_organization_key")
        .eq("id", body.organization_id)
        .single()

      if (org) {
        debriefData.organization_name = org.name
        if (!debriefData.karbon_client_key) {
          debriefData.karbon_client_key = org.karbon_organization_key
        }
      }
    }

    const { data, error } = await supabase.from("debriefs").insert(debriefData).select()

    if (error) {
      console.error("Error creating debrief:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const createdDebrief = data[0]

    await createDebriefNotifications(createdDebrief, body.team_member)

    return NextResponse.json({ debrief: createdDebrief })
  } catch (error) {
    console.error("Error in POST /api/debriefs:", error)
    return NextResponse.json({ error: "Failed to create debrief" }, { status: 500 })
  }
}

async function createDebriefNotifications(debrief: any, authorName: string) {
  try {
    // Fetch all active team members
    const { data: teamMembers } = await supabase
      .from("team_members")
      .select("id, full_name, email")
      .eq("is_active", true)

    if (!teamMembers || teamMembers.length === 0) return

    // Get client name for notification message
    let clientName = debrief.organization_name || "a client"
    if (debrief.contact_id) {
      const { data: contact } = await supabase
        .from("contacts")
        .select("full_name")
        .eq("id", debrief.contact_id)
        .single()
      if (contact) clientName = contact.full_name
    }

    // Create notification for all team members (except the author)
    const notifications = teamMembers
      .filter((tm) => tm.id !== debrief.created_by_id)
      .map((tm) => ({
        team_member_id: tm.id,
        notification_type: "debrief",
        entity_type: "debrief",
        entity_id: debrief.id,
        title: "New Client Debrief",
        message: `${authorName || "A team member"} submitted a debrief for ${clientName}`,
        action_url: `/?tab=debriefs&id=${debrief.id}`,
        is_read: false,
      }))

    if (notifications.length > 0) {
      await supabase.from("notifications").insert(notifications)
    }

    const actionItems = debrief.action_items?.items || []
    const actionNotifications: any[] = []

    for (const item of actionItems) {
      if (item.assignee_id && item.assignee_id !== debrief.created_by_id) {
        actionNotifications.push({
          team_member_id: item.assignee_id,
          notification_type: "action_item",
          entity_type: "debrief",
          entity_id: debrief.id,
          title: "New Action Item Assigned",
          message: `${authorName || "A team member"} assigned you an action item: "${item.description}"`,
          action_url: `/?tab=debriefs&id=${debrief.id}`,
          is_read: false,
        })
      }
    }

    if (actionNotifications.length > 0) {
      await supabase.from("notifications").insert(actionNotifications)
    }
  } catch (error) {
    console.error("Error creating debrief notifications:", error)
  }
}
