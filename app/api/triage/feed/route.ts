import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * GET /api/triage/feed?team_member_id=<uuid>&limit=50
 *
 * Unified, time-sorted activity feed for the Dashboard Triage panel.
 * Combines five sources into a single stream of "TriageItem" objects:
 *
 *   1. team_message       — posts from the firm's message board
 *   2. debrief            — recent client-service debriefs
 *   3. calendly_meeting   — newly scheduled Calendly events (any host)
 *   4. daily_briefing     — synthesized one-per-weekday entries that
 *                           mirror the morning cron's send window
 *   5. accepted_proposal  — Ignition proposals with `accepted_at` set
 *
 * Each item is anti-joined against the caller's `triage_dismissals` rows
 * so "Clear" hides the item from that user only — others still see it.
 *
 * The endpoint is deliberately read-only and shaped for the UI; we do not
 * surface raw rows. Each source has a `source_type` + `source_id` pair
 * that the dismiss endpoint expects to receive verbatim.
 */
export async function GET(request: Request) {
  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const teamMemberId = searchParams.get("team_member_id")
    const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 60, 10), 200)

    // Lookback window for each source. We pick generous-but-bounded ranges
    // so a partner returning from vacation still sees a usable feed without
    // hammering the DB. The newest items always win regardless of source.
    const now = new Date()
    const lookback14d = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
    const lookback7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const lookback3d = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)

    // Run every source query in parallel — none depend on each other and
    // the feed is bottlenecked on whichever source is slowest.
    const [
      messagesRes,
      debriefsRes,
      calendlyRes,
      proposalsRes,
      announcementsRes,
      dismissalsRes,
    ] = await Promise.allSettled([
      supabase
        .from("messages")
        .select(
          "id, author_name, author_initials, author_id, content, gif_url, is_pinned, created_at, updated_at, message_reactions(id, emoji, team_member_id), message_comments(id, author_name, author_initials, content, created_at)",
        )
        .gte("created_at", lookback7d.toISOString())
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("debriefs_full")
        .select(
          "id, debrief_date, notes, debrief_type, contact_id, organization_id, work_item_id, organization_name, contact_full_name, organization_display_name, work_item_title, work_item_karbon_url, karbon_work_url, team_member_full_name, created_by_full_name, created_at, action_items, follow_up_date, status",
        )
        .gte("created_at", lookback14d.toISOString())
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("calendly_events")
        .select(
          "id, calendly_uuid, name, start_time, end_time, status, calendly_user_name, team_member_id, location_type, location, join_url, meeting_id, calendly_created_at, event_type_name",
        )
        // Surface meetings that were *scheduled* recently, regardless of
        // when the meeting itself takes place — that's the "new meeting"
        // signal partners care about.
        .gte("calendly_created_at", lookback7d.toISOString())
        .neq("status", "canceled")
        .order("calendly_created_at", { ascending: false })
        .limit(40),
      supabase
        .from("ignition_proposals_enriched")
        .select(
          "proposal_id, title, client_name, contact_full_name, organization_name, contact_id, organization_id, accepted_at, total_value, recurring_total, one_time_total, recurring_frequency, currency, status, signed_url, proposal_sent_by, client_partner, client_manager",
        )
        .gte("accepted_at", lookback14d.toISOString())
        .order("accepted_at", { ascending: false })
        .limit(40),
      supabase
        .from("firm_announcements")
        .select("id, topic, announcement, action_items, created_by_name, created_at, email_sent_count")
        .gte("created_at", lookback14d.toISOString())
        .order("created_at", { ascending: false })
        .limit(40),
      teamMemberId
        ? supabase
            .from("triage_dismissals")
            .select("source_type, source_id")
            .eq("team_member_id", teamMemberId)
        : Promise.resolve({ data: [] as Array<{ source_type: string; source_id: string }>, error: null }),
    ])

    // Build a Set of "type:id" keys for O(1) anti-join on the next pass.
    const dismissed = new Set<string>()
    if (dismissalsRes.status === "fulfilled" && !dismissalsRes.value.error) {
      for (const d of dismissalsRes.value.data || []) {
        dismissed.add(`${d.source_type}:${d.source_id}`)
      }
    }

    const items: TriageItem[] = []

    // ── Team Messages ────────────────────────────────────────────────────
    if (messagesRes.status === "fulfilled" && !messagesRes.value.error) {
      for (const m of messagesRes.value.data || []) {
        if (dismissed.has(`team_message:${m.id}`)) continue
        const rawReactions = (m.message_reactions || []) as Array<{
          id: string
          emoji: string
          team_member_id: string | null
        }>
        const rawComments = (m.message_comments || []) as Array<{
          id: string
          author_name: string
          author_initials: string | null
          content: string
          created_at: string
        }>
        // Aggregate reactions by emoji for the expanded view so we don't
        // ship every individual reaction row to the client.
        const reactionTally: Record<string, number> = {}
        for (const r of rawReactions) {
          reactionTally[r.emoji] = (reactionTally[r.emoji] || 0) + 1
        }
        items.push({
          id: m.id,
          source_type: "team_message",
          source_id: m.id,
          timestamp: m.created_at,
          actor_name: m.author_name,
          actor_initials: m.author_initials,
          actor_id: m.author_id,
          title: m.author_name,
          summary: m.content || "(media post)",
          metadata: {
            gif_url: m.gif_url,
            is_pinned: m.is_pinned,
            reaction_count: rawReactions.length,
            comment_count: rawComments.length,
            reactions: Object.entries(reactionTally).map(([emoji, count]) => ({ emoji, count })),
            comments: rawComments
              .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
              .slice(0, 20)
              .map((c) => ({
                id: c.id,
                author_name: c.author_name,
                author_initials: c.author_initials,
                content: c.content,
                created_at: c.created_at,
              })),
            updated_at: m.updated_at,
          },
        })
      }
    }

    // ── Firm Announcements (Broadcast) ───────────────────────────────────
    // Firm-wide announcements composed in /admin/broadcast. Each row is
    // visible to everyone until they personally clear it.
    if (announcementsRes.status === "fulfilled" && !announcementsRes.value.error) {
      for (const a of (announcementsRes.value.data || []) as Array<{
        id: string
        topic: string
        announcement: string
        action_items: string | null
        created_by_name: string | null
        created_at: string
      }>) {
        if (dismissed.has(`broadcast:${a.id}`)) continue
        items.push({
          id: a.id,
          source_type: "broadcast",
          source_id: a.id,
          timestamp: a.created_at,
          actor_name: a.created_by_name || "ALFRED Ai",
          actor_initials: "AI",
          title: a.topic,
          summary: truncate(a.announcement, 240),
          metadata: {
            announcement: a.announcement,
            action_items: a.action_items,
            posted_by: a.created_by_name,
          },
        })
      }
    }

    // ── Debriefs ──────────────────────────────────────────────────────────
    if (debriefsRes.status === "fulfilled" && !debriefsRes.value.error) {
      for (const d of debriefsRes.value.data || []) {
        if (dismissed.has(`debrief:${d.id}`)) continue
        const clientName =
          d.contact_full_name ||
          d.organization_display_name ||
          d.organization_name ||
          "Untagged client"
        const author = d.team_member_full_name || d.created_by_full_name || "Team member"
        const actionItemsArray = Array.isArray(d.action_items?.items)
          ? (d.action_items!.items as Array<Record<string, unknown>>)
          : []
        // Prefer the contact link, fall back to organization. The
        // /clients/[id] page resolves either uuid kind, so we hand it
        // off whichever we have without forcing the caller to know
        // which.
        const clientId = d.contact_id || d.organization_id || null
        const clientKind: "contact" | "organization" | null = d.contact_id
          ? "contact"
          : d.organization_id
            ? "organization"
            : null
        items.push({
          id: d.id,
          source_type: "debrief",
          source_id: d.id,
          timestamp: d.created_at,
          actor_name: author,
          title: clientName,
          summary: truncate(d.notes || "No notes recorded.", 240),
          metadata: {
            debrief_type: d.debrief_type,
            work_item_title: d.work_item_title,
            work_item_id: d.work_item_id,
            // `debriefs_full` exposes the work item's Karbon URL alongside
            // the debrief's own Karbon URL — prefer whichever is set.
            karbon_work_url: d.work_item_karbon_url || d.karbon_work_url || null,
            client_id: clientId,
            client_kind: clientKind,
            client_name: clientName,
            follow_up_date: d.follow_up_date,
            status: d.status,
            action_item_count: actionItemsArray.length,
            // Full action item list for the expanded view. Capped to 25
            // so a runaway debrief doesn't bloat the response.
            action_items: actionItemsArray.slice(0, 25),
            full_notes: d.notes || "",
          },
        })
      }
    }

    // ── New Calendly meetings ────────────────────────────────────────────
    if (calendlyRes.status === "fulfilled" && !calendlyRes.value.error) {
      const events = (calendlyRes.value.data || []).filter(
        (e) => !dismissed.has(`calendly_meeting:${e.calendly_uuid || e.id}`),
      )

      // Batch-look up linked clients and work items for the visible event
      // set in one round-trip apiece so partners see "Open client", "Open
      // work item" affordances in the expanded card without us issuing
      // N+1 queries.
      const eventIds = events.map((e) => e.id)
      const meetingIds = events.map((e) => e.meeting_id).filter(Boolean) as string[]

      const [eventClientsRes, eventWorkItemsRes, eventInviteesRes, linkedMeetingsRes] =
        eventIds.length > 0
          ? await Promise.allSettled([
              supabase
                .from("calendly_event_clients")
                .select("calendly_event_id, contact_id, organization_id")
                .in("calendly_event_id", eventIds),
              supabase
                .from("calendly_event_work_items")
                .select("calendly_event_id, work_item_id")
                .in("calendly_event_id", eventIds),
              supabase
                .from("calendly_invitees")
                .select("calendly_event_id, name, email, contact_id")
                .in("calendly_event_id", eventIds),
              meetingIds.length > 0
                ? supabase
                    .from("meetings")
                    .select("id, contact_id, organization_id, work_item_id, video_link")
                    .in("id", meetingIds)
                : Promise.resolve({ data: [], error: null }),
            ])
          : []

      const clientsByEvent = new Map<
        string,
        { contact_id: string | null; organization_id: string | null }
      >()
      if (eventClientsRes?.status === "fulfilled" && !eventClientsRes.value.error) {
        for (const row of (eventClientsRes.value.data || []) as Array<{
          calendly_event_id: string
          contact_id: string | null
          organization_id: string | null
        }>) {
          // First explicit link wins; an event may be tagged to multiple
          // clients but the triage row only surfaces one.
          if (!clientsByEvent.has(row.calendly_event_id)) {
            clientsByEvent.set(row.calendly_event_id, {
              contact_id: row.contact_id,
              organization_id: row.organization_id,
            })
          }
        }
      }
      const workItemByEvent = new Map<string, string>()
      if (eventWorkItemsRes?.status === "fulfilled" && !eventWorkItemsRes.value.error) {
        for (const row of (eventWorkItemsRes.value.data || []) as Array<{
          calendly_event_id: string
          work_item_id: string
        }>) {
          if (!workItemByEvent.has(row.calendly_event_id)) {
            workItemByEvent.set(row.calendly_event_id, row.work_item_id)
          }
        }
      }
      const inviteesByEvent = new Map<
        string,
        Array<{ name: string | null; email: string | null; contact_id: string | null }>
      >()
      if (eventInviteesRes?.status === "fulfilled" && !eventInviteesRes.value.error) {
        for (const row of (eventInviteesRes.value.data || []) as Array<{
          calendly_event_id: string
          name: string | null
          email: string | null
          contact_id: string | null
        }>) {
          const list = inviteesByEvent.get(row.calendly_event_id) || []
          list.push({ name: row.name, email: row.email, contact_id: row.contact_id })
          inviteesByEvent.set(row.calendly_event_id, list)
        }
      }
      const meetingById = new Map<
        string,
        {
          contact_id: string | null
          organization_id: string | null
          work_item_id: string | null
          video_link: string | null
        }
      >()
      if (linkedMeetingsRes?.status === "fulfilled" && !linkedMeetingsRes.value.error) {
        for (const row of (linkedMeetingsRes.value.data || []) as Array<{
          id: string
          contact_id: string | null
          organization_id: string | null
          work_item_id: string | null
          video_link: string | null
        }>) {
          meetingById.set(row.id, row)
        }
      }

      for (const e of events) {
        // Resolve linked client / work item / video link by checking
        // explicit Calendly tags first, then falling back to the linked
        // Hub `meetings` row, then to the invitee with a Supabase
        // contact match.
        const explicitClient = clientsByEvent.get(e.id) || null
        const linkedMeeting = e.meeting_id ? meetingById.get(e.meeting_id) || null : null
        const invitees = inviteesByEvent.get(e.id) || []
        const inviteeContactId = invitees.find((iv) => iv.contact_id)?.contact_id || null

        const clientContactId =
          explicitClient?.contact_id || linkedMeeting?.contact_id || inviteeContactId || null
        const clientOrgId =
          explicitClient?.organization_id || linkedMeeting?.organization_id || null
        const clientId = clientContactId || clientOrgId || null
        const clientKind: "contact" | "organization" | null = clientContactId
          ? "contact"
          : clientOrgId
            ? "organization"
            : null

        items.push({
          id: e.id,
          source_type: "calendly_meeting",
          // Use the calendly_uuid for stable cross-system dismissal — even
          // if we re-import the row, the dismissal sticks to the meeting.
          source_id: e.calendly_uuid || e.id,
          timestamp: e.calendly_created_at || e.start_time,
          actor_name: e.calendly_user_name || "Calendly",
          title: e.name || "New meeting scheduled",
          summary: `${e.event_type_name || "Meeting"} • ${formatMeetingTime(e.start_time)}`,
          metadata: {
            start_time: e.start_time,
            end_time: e.end_time,
            location_type: e.location_type,
            location: e.location,
            host_name: e.calendly_user_name,
            event_type_name: e.event_type_name,
            join_url: e.join_url || linkedMeeting?.video_link || null,
            meeting_id: e.meeting_id,
            client_id: clientId,
            client_kind: clientKind,
            work_item_id: workItemByEvent.get(e.id) || linkedMeeting?.work_item_id || null,
            // Compact list of invitees — useful in the expanded view so
            // the user can see who actually booked the slot.
            invitees: invitees.slice(0, 5).map((iv) => ({
              name: iv.name,
              email: iv.email,
              contact_id: iv.contact_id,
            })),
          },
        })
      }
    }

    // ── Daily briefing (synthesized) ─────────────────────────────────────
    // The cron at app/api/cron/daily-briefing fires Mon–Fri at 12:00 UTC.
    // Rather than write a row per send (one row per recipient gets noisy
    // fast), we reconstruct the briefing entries directly from the
    // schedule for the last 3 weekdays and let dismissals work against
    // synthetic IDs of the form `daily-briefing-YYYY-MM-DD`.
    for (const dateKey of weekdayKeysSince(lookback3d, now)) {
      const sourceId = `daily-briefing-${dateKey}`
      if (dismissed.has(`daily_briefing:${sourceId}`)) continue
      // Briefing arrives at ~7-8 AM ET on the dateKey — pin the timestamp
      // to noon UTC so it sorts naturally with same-day items.
      const ts = new Date(`${dateKey}T12:00:00Z`).toISOString()
      // Skip future dates (in case of clock skew or tests run "tomorrow").
      if (new Date(ts).getTime() > now.getTime()) continue
      items.push({
        id: sourceId,
        source_type: "daily_briefing",
        source_id: sourceId,
        timestamp: ts,
        actor_name: "ALFRED Ai",
        actor_initials: "AI",
        title: "Daily Briefing",
        summary: `Your morning briefing for ${formatBriefingDate(dateKey)} was sent.`,
        metadata: {
          date_key: dateKey,
        },
      })
    }

    // ── Accepted Ignition proposals ──────────────────────────────────────
    if (proposalsRes.status === "fulfilled" && !proposalsRes.value.error) {
      const proposals = (proposalsRes.value.data || []).filter(
        (p) => p.accepted_at && !dismissed.has(`accepted_proposal:${p.proposal_id}`),
      )

      // Pull line items for the visible proposal set so the expanded
      // card can show what was actually accepted.
      const proposalIds = proposals.map((p) => p.proposal_id).filter(Boolean) as string[]
      const servicesByProposal = new Map<
        string,
        Array<{
          service_name: string
          description: string | null
          total_amount: number | null
          billing_frequency: string | null
          quantity: number | null
        }>
      >()
      if (proposalIds.length > 0) {
        const servicesRes = await supabase
          .from("ignition_proposal_services")
          .select("proposal_id, service_name, description, total_amount, billing_frequency, quantity, ordinal")
          .in("proposal_id", proposalIds)
          .order("ordinal", { ascending: true })
        if (!servicesRes.error) {
          for (const s of (servicesRes.data || []) as Array<{
            proposal_id: string
            service_name: string
            description: string | null
            total_amount: number | null
            billing_frequency: string | null
            quantity: number | null
          }>) {
            const list = servicesByProposal.get(s.proposal_id) || []
            list.push({
              service_name: s.service_name,
              description: s.description,
              total_amount: s.total_amount,
              billing_frequency: s.billing_frequency,
              quantity: s.quantity,
            })
            servicesByProposal.set(s.proposal_id, list)
          }
        }
      }

      for (const p of proposals) {
        const clientName =
          p.contact_full_name ||
          p.organization_name ||
          p.client_name ||
          "Client"
        const clientId = p.contact_id || p.organization_id || null
        const clientKind: "contact" | "organization" | null = p.contact_id
          ? "contact"
          : p.organization_id
            ? "organization"
            : null
        items.push({
          id: p.proposal_id,
          source_type: "accepted_proposal",
          source_id: p.proposal_id,
          timestamp: p.accepted_at,
          actor_name: clientName,
          title: `Proposal accepted: ${p.title || "Untitled proposal"}`,
          summary: `${clientName} accepted ${formatCurrency(p.total_value, p.currency)}${
            p.proposal_sent_by ? ` (sent by ${p.proposal_sent_by})` : ""
          }`,
          metadata: {
            total_value: p.total_value,
            recurring_total: p.recurring_total,
            one_time_total: p.one_time_total,
            recurring_frequency: p.recurring_frequency,
            currency: p.currency,
            client_name: clientName,
            client_id: clientId,
            client_kind: clientKind,
            client_partner: p.client_partner,
            client_manager: p.client_manager,
            proposal_sent_by: p.proposal_sent_by,
            proposal_url: p.signed_url,
            services: servicesByProposal.get(p.proposal_id) || [],
          },
        })
      }
    }

    // Sort by timestamp DESC (most-recent first) and cap at requested limit.
    items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    const trimmed = items.slice(0, limit)

    return NextResponse.json({ items: trimmed, total: items.length })
  } catch (error) {
    console.error("Error building triage feed:", error)
    return NextResponse.json({ error: "Failed to build triage feed" }, { status: 500 })
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Types
 * ─────────────────────────────────────────────────────────────────────── */

export type TriageSourceType =
  | "team_message"
  | "broadcast"
  | "debrief"
  | "calendly_meeting"
  | "daily_briefing"
  | "accepted_proposal"

export interface TriageItem {
  id: string
  source_type: TriageSourceType
  // Polymorphic dismissal key — passed back to /api/triage/dismiss verbatim.
  source_id: string
  timestamp: string
  actor_name: string
  actor_initials?: string
  actor_id?: string | null
  title: string
  summary: string
  // Source-specific extras the UI can render conditionally.
  metadata?: Record<string, unknown>
}

/* ─────────────────────────────────────────────────────────────────────────
 * Helpers
 * ─────────────────────────────────────────────────────────────────────── */

function truncate(s: string, n: number): string {
  if (!s) return ""
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…"
}

function formatMeetingTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  })
}

function formatBriefingDate(dateKey: string): string {
  return new Date(`${dateKey}T12:00:00-05:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/New_York",
  })
}

function formatCurrency(value: number | null, currency: string | null): string {
  if (value == null) return "—"
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `$${value}`
  }
}

/**
 * Returns YYYY-MM-DD keys for every weekday between `from` and `to`
 * (inclusive of `to`, exclusive of weekends). Used to synthesize the
 * Daily Briefing rows since we don't persist the cron's send history.
 */
function weekdayKeysSince(from: Date, to: Date): string[] {
  const keys: string[] = []
  const cursor = new Date(from)
  cursor.setUTCHours(12, 0, 0, 0)
  while (cursor.getTime() <= to.getTime()) {
    const dow = cursor.getUTCDay() // 0=Sun, 6=Sat in UTC — close enough to ET for a Mon–Fri window
    if (dow !== 0 && dow !== 6) {
      keys.push(cursor.toISOString().slice(0, 10))
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return keys
}
