import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import {
  buildDebriefEmailHtml,
  buildNotificationEmailHtml,
  resolveRecipientsForCategory,
  sendEmail,
} from "@/lib/email"
import { postDebriefNoteToKarbon } from "@/lib/karbon/post-debrief-note"

const KARBON_TENANT_BASE = "https://app2.karbonhq.com/4mTyp9lLRWTC#"

/**
 * Build the same `https://app2.karbonhq.com/<tenant>#/...` URLs we already
 * persist on contacts/organizations/work_items, derived directly from the
 * Karbon entity key. Used for email deep-link rendering when the related
 * record was passed in from the form (which only carries the key, not the URL).
 */
function buildKarbonUrl(
  type: "contact" | "organization" | "work",
  key?: string | null,
): string | null {
  if (!key) return null
  if (type === "contact") return `${KARBON_TENANT_BASE}/contacts/${key}`
  if (type === "organization") return `${KARBON_TENANT_BASE}/organizations/${key}`
  return `${KARBON_TENANT_BASE}/work/${key}`
}

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

    // Push the debrief into Karbon as a Note attached to every related work
    // item AND every related contact/organization timeline. This is best-effort
    // — a Karbon outage or credential issue must NOT block the debrief or the
    // team email. We log success/failure for the admin Karbon sync dashboard.
    try {
      const karbonResult = await postDebriefNoteToKarbon(createdDebrief, body)
      if (karbonResult.ok) {
        console.log(
          `[v0] Karbon note created (${karbonResult.noteKey}) attached to ${karbonResult.attachedTimelines} timeline(s)`,
        )
      } else if (karbonResult.skipped) {
        console.log(`[v0] Karbon note push skipped: ${karbonResult.skipped}`)
      } else if (karbonResult.error) {
        console.warn(`[v0] Karbon note push failed: ${karbonResult.error}`)
      }
    } catch (karbonErr) {
      console.warn(
        "[v0] Unexpected error pushing debrief to Karbon:",
        karbonErr instanceof Error ? karbonErr.message : karbonErr,
      )
    }

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
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || "https://mottahub-motta.vercel.app"
    const debriefUrl = `${siteUrl}/debriefs?id=${debrief.id}`

    // Resolve client name for messages/subject
    let clientName = debrief.organization_name || "a client"
    if (debrief.contact_id) {
      const { data: contact } = await supabase
        .from("contacts")
        .select("full_name")
        .eq("id", debrief.contact_id)
        .single()
      if (contact) clientName = contact.full_name
    }
    const relatedClientNames = (body?.related_clients || []).map((c: any) => c.name).filter(Boolean)
    if (relatedClientNames.length > 0) {
      clientName = relatedClientNames.join(", ")
    }

    // ============================================
    // 1. Team-wide debrief notification — UNCONDITIONAL
    // ============================================
    // Per firm policy: every debrief is broadcast to ALL active teammates
    // (excluding Company / Alumni roles). The author IS included so they
    // receive their own confirmation copy that the debrief was submitted and
    // the team email went out. The form's notify_team toggle and recipient
    // picker are intentionally ignored, and the per-user "debrief" email
    // opt-out is bypassed for this broadcast so no one misses a client debrief.
    const { data: activeTeam } = await supabase
      .from("team_members")
      .select("id, full_name, email, role")
      .eq("is_active", true)
      .not("role", "eq", "Company")
      .not("role", "eq", "Alumni")

    if (recipientEmails.length > 0) {
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.APP_BASE_URL || "https://mottahub-motta.vercel.app"
      const debriefUrl = `${siteUrl}/debriefs?id=${debrief.id}`

      // Resolve the primary work item title for the subject line
      let workItemTitle: string | null = null
      const relatedWorkItemsForSubject = body?.related_work_items || []
      if (relatedWorkItemsForSubject.length > 0) {
        workItemTitle = relatedWorkItemsForSubject[0].title || null
      }
      if (!workItemTitle && debrief.work_item_id) {
        const { data: workItem } = await supabase
          .from("work_items")
          .select("title")
          .eq("id", debrief.work_item_id)
          .single()
        if (workItem) workItemTitle = workItem.title
      }

      const subjectName = workItemTitle || clientName
      const subject = `DEBRIEF: ${subjectName}`

      const html = buildDebriefEmailHtml({
        authorName: authorName || "A team member",
        clientName,
        workItemTitle,
        debriefDate: debrief.debrief_date
          ? new Date(debrief.debrief_date).toLocaleDateString("en-US", {
    const targetMembers = activeTeam || []

    if (targetMembers.length > 0) {
      // 1a. In-app notification row for every active teammate.
      //     The author gets a confirmation-styled message instead of the
      //     generic team announcement so they can verify it went through.
      const notifications = targetMembers.map((tm) => {
        const isAuthor = tm.id === debrief.created_by_id
        return {
          team_member_id: tm.id,
          notification_type: "debrief",
          entity_type: "debrief",
          entity_id: debrief.id,
          title: isAuthor ? "Debrief Submitted" : "New Client Debrief",
          message: isAuthor
            ? `Your debrief for ${clientName} was submitted and emailed to the team.`
            : `${authorName || "A team member"} submitted a debrief for ${clientName}`,
          action_url: `/?tab=debriefs&id=${debrief.id}`,
          is_read: false,
        }
      })
      await supabase.from("notifications").insert(notifications)

      // 1b. Email every active teammate who has an email address — author included.
      //     No opt-out check — debriefs are mandatory firm-wide visibility.
      const recipientEmails = targetMembers
        .filter((tm) => !!tm.email)
        .map((tm) => tm.email as string)

      if (recipientEmails.length > 0) {
        // Build Karbon deep-link arrays from the related entities that came in
        // with the form payload. The URLs use the tenant-scoped Karbon UI
        // pattern that matches what we already store on the contacts /
        // organizations / work_items tables.
        const relatedClientsForEmail = (body?.related_clients || [])
          .filter((c: any) => c?.name)
          .map((c: any) => ({
            name: c.name,
            type: c.type,
            karbonUrl: buildKarbonUrl(
              c.type === "organization" ? "organization" : "contact",
              c.karbon_key,
            ),
          }))
        const relatedWorkItemsForEmail = (body?.related_work_items || [])
          .filter((w: any) => w?.title)
          .map((w: any) => ({
            title: w.title,
            workType: w.work_type || null,
            karbonUrl: buildKarbonUrl("work", w.karbon_key),
          }))

        const followUpDateLabel = debrief.follow_up_date
          ? new Date(debrief.follow_up_date).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })
          : undefined

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
          feeAdjustmentReason: body?.fee_adjustment_reason || undefined,
          followUpDate: followUpDateLabel,
          relatedClients: relatedClientsForEmail,
          relatedWorkItems: relatedWorkItemsForEmail,
          debriefUrl,
        })

      const emailResult = await sendEmail({
        to: recipientEmails,
        subject,
        html,
      })

      if (!emailResult.success) {
        console.warn("[debrief] Email send failed (in-app notifications still created):", emailResult.error)
      } else {
        console.log(`[debrief] Email sent to ${recipientEmails.length} active team members with subject: ${subject}`)
        const emailResult = await sendEmail({
          to: recipientEmails,
          subject: `New Debrief: ${clientName} - ${authorName || "Team Member"}`,
          html,
        })

        if (!emailResult.success) {
          console.warn("[debrief] Team email failed:", emailResult.error)
        } else {
          console.log(
            `[debrief] Team email sent to all ${recipientEmails.length} active teammates (author included)`,
          )
        }
      }
    }

    // ============================================
    // 2. Action-item assignee notifications (always sent, even if notify_team=false —
    //    direct assignments are personal and shouldn't be silenceable via the team toggle).
    //    Uses the "action_item" category for email opt-out.
    // ============================================
    const actionItems = debrief.action_items?.items || []
    const actionNotifications: any[] = []
    const assigneeEmailMap = new Map<string, { description: string; assigneeName?: string }>()

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
        // Keep the most recent assignment description per assignee (in case of duplicates)
        assigneeEmailMap.set(item.assignee_id, {
          description: item.description,
          assigneeName: item.assignee_name,
        })
      }
    }

    if (actionNotifications.length > 0) {
      await supabase.from("notifications").insert(actionNotifications)
    }

    if (assigneeEmailMap.size > 0) {
      const optedInAssignees = await resolveRecipientsForCategory(
        Array.from(assigneeEmailMap.keys()),
        "action_item",
      )

      // Send a personalized email per assignee with their specific item description
      await Promise.all(
        optedInAssignees.map(async (recipient) => {
          const item = assigneeEmailMap.get(recipient.team_member_id)
          if (!item) return
          const html = buildNotificationEmailHtml({
            recipientName: recipient.full_name?.split(" ")[0] || "there",
            title: "New Action Item Assigned",
            message: `${authorName || "A team member"} assigned you an action item from a debrief on ${clientName}:\n\n"${item.description}"`,
            actionUrl: debriefUrl,
            actionLabel: "View Debrief",
          })
          const res = await sendEmail({
            to: recipient.email,
            subject: `Action item: ${item.description.slice(0, 60)}${item.description.length > 60 ? "…" : ""}`,
            html,
          })
          if (!res.success) {
            console.warn(`[debrief] Action-item email to ${recipient.email} failed:`, res.error)
          }
        }),
      )
    }
  } catch (error) {
    console.error("Error creating debrief notifications:", error)
  }
}
