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
  const hasActionItems = searchParams.get("has_action_items") === "true"
  const limit = Number.parseInt(searchParams.get("limit") || "50")

  // Use the enriched view when we need joined data (for to-do list)
  // Otherwise use the base table for faster queries
  const selectFields = hasActionItems
    ? `*,
       organizations:organization_id (name),
       contacts:contact_id (full_name),
       created_by:created_by_id (full_name),
       team_member:team_member_id (full_name)`
    : "*"

  let query = supabase
    .from("debriefs")
    .select(selectFields)
    .order("debrief_date", { ascending: false })
    .limit(limit)

  // Filter by contact or organization UUID
  if (contactId) {
    query = query.eq("contact_id", contactId)
  } else if (organizationId) {
    query = query.eq("organization_id", organizationId)
  } else if (clientKey) {
    query = query.or(`karbon_client_key.eq.${clientKey},organization_name.ilike.%${clientKey}%`)
  }

  // Filter to only debriefs that have action items
  if (hasActionItems) {
    query = query.not("action_items", "is", null)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Transform joined data for cleaner response
  const debriefs = hasActionItems
    ? (data || []).map((d: any) => ({
        ...d,
        organization_display_name: d.organizations?.name || d.organization_name,
        contact_full_name: d.contacts?.full_name || null,
        created_by_full_name: d.created_by?.full_name || null,
        team_member_full_name: d.team_member?.full_name || null,
        // Clean up joined relations from response
        organizations: undefined,
        contacts: undefined,
        created_by: undefined,
        team_member: undefined,
      }))
    : data

  return NextResponse.json({ debriefs })
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()

    // Extract the first related client and work item for the main FK columns
    const relatedClients = body.related_clients || []
    const relatedWorkItems = body.related_work_items || []
    // The form now sends an explicit `primary_contact` — the contact or
    // organization the debrief is tagged TO (auto-populated from the work
    // item's owning client in Karbon). This is the source of truth for
    // debriefs.contact_id / debriefs.organization_id, which power every
    // dashboard filter and email subject downstream.
    const primaryContact = body.primary_contact || null

    // Optional link to the specific meeting this debrief covers. The form
    // forwards exactly one of these when launched from a meeting's detail
    // dialog (or the post-meeting ALFRED email). They map to the
    // debriefs.calendly_event_id / zoom_meeting_id FKs added in migration 332.
    const calendlyEventId: string | null = body.calendly_event_id || null
    const zoomMeetingId: string | null = body.zoom_meeting_id || null

    // Determine contact_id and organization_id, preferring the explicit
    // primary contact and falling back to the first related client for
    // back-compat with any older form payloads still in flight.
    let contactId: string | null = null
    let organizationId: string | null = null
    let organizationName: string | null = null
    let karbonClientKey: string | null = null

    if (primaryContact?.id) {
      if (primaryContact.type === "organization") {
        organizationId = primaryContact.id
      } else if (primaryContact.type === "contact") {
        contactId = primaryContact.id
      }
      karbonClientKey = primaryContact.karbon_key || null
    } else {
      for (const client of relatedClients) {
        if (client.type === "contact" && !contactId) {
          contactId = client.id
          karbonClientKey = client.karbon_key || null
        } else if (client.type === "organization" && !organizationId) {
          organizationId = client.id
          karbonClientKey = karbonClientKey || client.karbon_key || null
        }
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
      // Link to the specific meeting this debrief covers (one or neither).
      calendly_event_id: toUuidOrNull(calendlyEventId),
      zoom_meeting_id: toUuidOrNull(zoomMeetingId),
    }

    // Store all extra data in the action_items JSONB column
    debriefData.action_items = {
      items: body.action_items || [],
      // Persist primary_contact alongside related_clients so it survives
      // round-trips (edit sheet, email re-render, Karbon retry). The
      // canonical FKs above are still the source of truth for filtering.
      primary_contact: primaryContact,
      related_clients: relatedClients,
      related_work_items: relatedWorkItems,
      service_lines: body.services || [],
      research_topics: body.research_topics || "",
      fee_adjustment: body.fee_adjustment || null,
      fee_adjustment_reason: body.fee_adjustment_reason || null,
      notify_team: body.notify_team || false,
      notification_recipients: body.notification_recipients || [],
      team_member_name: body.team_member || null,
      // Files uploaded with the debrief — each is a Vercel Blob URL plus
      // metadata produced by POST /api/debriefs/attachments. We keep them
      // on the JSONB blob (rather than a dedicated column) to avoid a
      // schema migration; the debrief detail view and edit sheet read
      // from the same shape. Limited to 10 to bound payload size on the
      // re-render path.
      attachments: Array.isArray(body.attachments)
        ? body.attachments.slice(0, 10).map((a: any) => ({
            url: a?.url ?? null,
            pathname: a?.pathname ?? null,
            name: a?.name ?? "attachment",
            content_type: a?.content_type ?? null,
            size_bytes: typeof a?.size_bytes === "number" ? a.size_bytes : null,
            uploaded_at: a?.uploaded_at ?? new Date().toISOString(),
          }))
        : [],
}
  
  const { data, error } = await supabase.from("debriefs").insert(debriefData).select()

    if (error) {
      console.error("[v0] Supabase insert error:", error.message, error.details, error.hint, error.code)
      return NextResponse.json({ error: error.message }, { status: 500 })
}
  
  const createdDebrief = data[0]

    // If this debrief was filed against a specific meeting, stamp that meeting
    // so the hourly debrief-reminder cron treats it as handled and never emails
    // a (now-redundant) request for it. Best-effort — failure must not block.
    try {
      if (calendlyEventId) {
        await supabase
          .from("calendly_events")
          .update({ debrief_requested_at: new Date().toISOString() })
          .eq("id", calendlyEventId)
          .is("debrief_requested_at", null)
      } else if (zoomMeetingId) {
        await supabase
          .from("zoom_meetings")
          .update({ debrief_requested_at: new Date().toISOString() })
          .eq("id", zoomMeetingId)
          .is("debrief_requested_at", null)
      }
    } catch (markErr) {
      console.warn(
        "[v0] Failed to stamp meeting debrief_requested_at:",
        markErr instanceof Error ? markErr.message : markErr,
      )
    }

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
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || "https://hub.motta.cpa"
    const debriefUrl = `${siteUrl}/debriefs?id=${debrief.id}`

    // Resolve client name for messages/subject. Order of preference:
    //   1. The explicit primary_contact name (best — always the right tag)
    //   2. The org name we already denormalized onto the debrief row
    //   3. A live lookup of the joined contact
    //   4. The concatenated related-client names (legacy fallback)
    const primaryContact = body?.primary_contact || null
    let clientName: string =
      primaryContact?.name || debrief.organization_name || "a client"
    if (!primaryContact?.name && debrief.contact_id) {
      const { data: contact } = await supabase
        .from("contacts")
        .select("full_name")
        .eq("id", debrief.contact_id)
        .single()
      if (contact) clientName = contact.full_name
    }
    if (!primaryContact?.name) {
      // Legacy fallback only — when no primary was sent, fold every related
      // client into the displayed name (preserves old behavior for older
      // clients still using the previous form payload shape).
      const relatedClientNames = (body?.related_clients || [])
        .map((c: any) => c.name)
        .filter(Boolean)
      if (relatedClientNames.length > 0) {
        clientName = relatedClientNames.join(", ")
      }
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

    const targetMembers = activeTeam || []

    if (targetMembers.length > 0) {
      // 1a. In-app notification row for every active teammate.
      //     The author gets a confirmation-styled message instead of the
      //     generic team announcement so they can verify it went through.
      const notifications = targetMembers.map((tm: any) => {
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
        .filter((tm: any) => !!tm.email)
        .map((tm: any) => tm.email as string)

      if (recipientEmails.length > 0) {
        // Resolve the primary work item title for the subject line.
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

        // Build Karbon deep-link arrays from the related entities that came
        // in with the form payload. The URLs use the tenant-scoped Karbon UI
        // pattern that matches what we already store on the contacts /
        // organizations / work_items tables.
        const primaryContactForEmail = primaryContact?.name
          ? {
              name: primaryContact.name,
              type: primaryContact.type,
              karbonUrl: buildKarbonUrl(
                primaryContact.type === "organization" ? "organization" : "contact",
                primaryContact.karbon_key,
              ),
            }
          : null
        // De-dupe primary out of "related" — the email renders them in
        // separate rows, and showing the same person in both feels buggy.
        // We match on Karbon key first (stable) then fall back to name.
        const relatedClientsForEmail = (body?.related_clients || [])
          .filter((c: any) => {
            if (!c?.name) return false
            if (!primaryContact) return true
            if (primaryContact.karbon_key && c.karbon_key) {
              return c.karbon_key !== primaryContact.karbon_key
            }
            return c.name !== primaryContact.name
          })
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

        const debriefDateLabel = debrief.debrief_date
          ? new Date(debrief.debrief_date).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })
          : "N/A"

        const followUpDateLabel = debrief.follow_up_date
          ? new Date(debrief.follow_up_date).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })
          : undefined

        // Files uploaded with this debrief. Persisted on the action_items
        // JSONB blob by the POST handler above, but we also have them on
        // the inbound `body` for the very first send. Filter to entries
        // that actually have a URL — defensive against partial payloads
        // from older clients.
        const persistedAttachments = Array.isArray(
          debrief.action_items?.attachments,
        )
          ? debrief.action_items.attachments
          : []
        const attachmentsForEmail = (
          persistedAttachments.length > 0
            ? persistedAttachments
            : Array.isArray(body?.attachments)
              ? body.attachments
              : []
        )
          .filter((a: any) => a?.url && a?.name)
          .map((a: any) => ({
            name: a.name as string,
            url: a.url as string,
            size_bytes:
              typeof a.size_bytes === "number" ? (a.size_bytes as number) : null,
            content_type: (a.content_type as string | null) ?? null,
          }))

        const html = buildDebriefEmailHtml({
          authorName: authorName || "A team member",
          clientName,
          workItemTitle,
          debriefDate: debriefDateLabel,
          notes: body?.notes || debrief.notes || undefined,
          actionItems: debrief.action_items?.items || body?.action_items || [],
          services: body?.services || [],
          researchTopics: body?.research_topics || undefined,
          feeAdjustment: body?.fee_adjustment || undefined,
          feeAdjustmentReason: body?.fee_adjustment_reason || undefined,
          followUpDate: followUpDateLabel,
          primaryContact: primaryContactForEmail,
          relatedClients: relatedClientsForEmail,
          relatedWorkItems: relatedWorkItemsForEmail,
          attachments: attachmentsForEmail,
          debriefUrl,
        })

        const subjectName = workItemTitle || clientName
        const subject = `DEBRIEF: ${subjectName}`

        // Resend-side attachments — these become real mail attachments on
        // delivery. The body of the email ALSO renders a clickable list
        // (above) so the recipient can re-download from Blob if their
        // client strips binaries (some corporate filters do). Resend
        // fetches each `path` URL, so the file has to be public-readable
        // (our Blob store is) and reachable from Resend's egress.
        const resendAttachments = attachmentsForEmail.map(
          (a: {
            name: string
            url: string
            content_type: string | null
          }) => ({
            filename: a.name,
            path: a.url,
            contentType: a.content_type || undefined,
          }),
        )

        const emailResult = await sendEmail({
          to: recipientEmails,
          subject,
          html,
          attachments: resendAttachments,
        })

        if (!emailResult.success) {
          console.warn("[debrief] Email send failed (in-app notifications still created):", emailResult.error)
        } else {
          console.log(
            `[debrief] Email sent to ${recipientEmails.length} active team members with subject: ${subject}`,
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
