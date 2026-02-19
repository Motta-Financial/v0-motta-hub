import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { sendEmail, buildDebriefEmailHtml } from "@/lib/email"

export async function GET(request: NextRequest) {
  const supabase = createAdminClient()
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
    const supabase = createAdminClient()
    const body = await request.json()
    console.log("[v0] POST /api/debriefs received body keys:", Object.keys(body))
    console.log("[v0] related_clients:", JSON.stringify(body.related_clients))
    console.log("[v0] related_work_items:", JSON.stringify(body.related_work_items))
    console.log("[v0] created_by_id:", body.created_by_id)

    // Extract the first related client and work item for the main FK columns
    const relatedClients = body.related_clients || []
    const relatedWorkItems = body.related_work_items || []

    // Determine contact_id and organization_id from the first related client
    let contactId: string | null = null
    let organizationId: string | null = null
    let organizationName: string | null = null
    let karbonClientKey: string | null = null

    for (const client of relatedClients) {
      if (client.type === "contact" && !contactId) {
        contactId = client.id
        karbonClientKey = client.karbon_key || null
      } else if (client.type === "organization" && !organizationId) {
        organizationId = client.id
        karbonClientKey = karbonClientKey || client.karbon_key || null
      }
    }

    // Look up names/keys from the DB for the linked contact/org
    if (contactId) {
      const { data: contact } = await supabase
        .from("contacts")
        .select("full_name, karbon_contact_key")
        .eq("id", contactId)
        .single()
      if (contact) {
        karbonClientKey = karbonClientKey || contact.karbon_contact_key
      }
    }
    if (organizationId) {
      const { data: org } = await supabase
        .from("organizations")
        .select("name, karbon_organization_key")
        .eq("id", organizationId)
        .single()
      if (org) {
        organizationName = org.name
        karbonClientKey = karbonClientKey || org.karbon_organization_key
      }
    }

    // Helper: convert empty strings to null for UUID columns
    const toUuidOrNull = (val: any): string | null => {
      if (!val || val === "") return null
      return val
    }

    // Build the debrief row -- only include columns that exist in the debriefs table
    const debriefData: Record<string, any> = {
      debrief_date: body.debrief_date,
      notes: body.notes || null,
      follow_up_date: body.follow_up_date || null,
      team_member_id: toUuidOrNull(body.created_by_id),
      created_by_id: toUuidOrNull(body.created_by_id),
      contact_id: toUuidOrNull(contactId),
      organization_id: toUuidOrNull(organizationId),
      organization_name: organizationName || null,
      work_item_id: relatedWorkItems.length > 0 ? toUuidOrNull(relatedWorkItems[0].id) : null,
      karbon_client_key: karbonClientKey || null,
      status: body.status || "completed",
      debrief_type: body.debrief_type || "meeting",
    }

    // Store all extra data in the action_items JSONB column
    debriefData.action_items = {
      items: body.action_items || [],
      related_clients: relatedClients,
      related_work_items: relatedWorkItems,
      service_lines: body.services || [],
      research_topics: body.research_topics || "",
      fee_adjustment: body.fee_adjustment || null,
      fee_adjustment_reason: body.fee_adjustment_reason || null,
      notify_team: body.notify_team || false,
      notification_recipients: body.notification_recipients || [],
      team_member_name: body.team_member || null,
    }

    console.log("[v0] Debrief insert payload:", JSON.stringify(debriefData, null, 2))

    const { data, error } = await supabase.from("debriefs").insert(debriefData).select()

    if (error) {
      console.error("[v0] Supabase insert error:", error.message, error.details, error.hint, error.code)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    console.log("[v0] Debrief created successfully:", data?.[0]?.id)

    const createdDebrief = data[0]

    await createDebriefNotifications(createdDebrief, body.team_member, body)

    return NextResponse.json({ debrief: createdDebrief })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("Error in POST /api/debriefs:", message, error)
    return NextResponse.json({ error: `Failed to create debrief: ${message}` }, { status: 500 })
  }
}

async function createDebriefNotifications(debrief: any, authorName: string, body: any) {
  try {
    const supabase = createAdminClient()
    // Fetch all active team members (excluding Company and Alumni roles)
    const { data: teamMembers } = await supabase
      .from("team_members")
      .select("id, full_name, email, role")
      .eq("is_active", true)
      .not("role", "eq", "Company")
      .not("role", "eq", "Alumni")

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

    // Also use related_clients from body for better naming
    const relatedClientNames = (body?.related_clients || []).map((c: any) => c.name).filter(Boolean)
    if (relatedClientNames.length > 0) {
      clientName = relatedClientNames.join(", ")
    }

    // Create in-app notification for all team members (except the author)
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

    // Send EMAIL to all active team members (except author)
    const recipientEmails = teamMembers
      .filter((tm) => tm.id !== debrief.created_by_id && tm.email)
      .map((tm) => tm.email)

    if (recipientEmails.length > 0) {
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://mottahub-motta.vercel.app"
      const debriefUrl = `${siteUrl}/debriefs?id=${debrief.id}`

      const html = buildDebriefEmailHtml({
        authorName: authorName || "A team member",
        clientName,
        debriefDate: debrief.debrief_date
          ? new Date(debrief.debrief_date).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })
          : "N/A",
        notes: body?.notes || debrief.notes || undefined,
        actionItems: debrief.action_items?.items || body?.action_items || [],
        services: body?.services || [],
        researchTopics: body?.research_topics || undefined,
        feeAdjustment: body?.fee_adjustment || undefined,
        debriefUrl,
      })

      const emailResult = await sendEmail({
        to: recipientEmails,
        subject: `New Debrief: ${clientName} - ${authorName || "Team Member"}`,
        html,
      })

      if (!emailResult.success) {
        console.warn("[debrief] Email send failed (in-app notifications still created):", emailResult.error)
      } else {
        console.log(`[debrief] Email sent to ${recipientEmails.length} active team members`)
      }
    }

    // Action item assignment notifications
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
