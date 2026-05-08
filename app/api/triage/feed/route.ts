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
      dismissalsRes,
    ] = await Promise.allSettled([
      supabase
        .from("messages")
        .select(
          "id, author_name, author_initials, author_id, content, gif_url, is_pinned, created_at, updated_at, message_reactions(id, emoji), message_comments(id)",
        )
        .gte("created_at", lookback7d.toISOString())
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("debriefs_full")
        .select(
          "id, debrief_date, notes, debrief_type, organization_name, contact_full_name, organization_display_name, work_item_title, team_member_full_name, created_by_full_name, created_at, action_items, follow_up_date, status",
        )
        .gte("created_at", lookback14d.toISOString())
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("calendly_events")
        .select(
          "id, calendly_uuid, name, start_time, end_time, status, calendly_user_name, team_member_id, location_type, calendly_created_at, event_type_name",
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
          "proposal_id, title, client_name, contact_full_name, organization_name, accepted_at, total_value, currency, status, signed_url, proposal_sent_by",
        )
        .gte("accepted_at", lookback14d.toISOString())
        .order("accepted_at", { ascending: false })
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
            reaction_count: (m.message_reactions || []).length,
            comment_count: (m.message_comments || []).length,
            updated_at: m.updated_at,
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
        const actionItemCount = Array.isArray(d.action_items?.items)
          ? d.action_items!.items.length
          : 0
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
            follow_up_date: d.follow_up_date,
            status: d.status,
            action_item_count: actionItemCount,
          },
        })
      }
    }

    // ── New Calendly meetings ────────────────────────────────────────────
    if (calendlyRes.status === "fulfilled" && !calendlyRes.value.error) {
      for (const e of calendlyRes.value.data || []) {
        if (dismissed.has(`calendly_meeting:${e.id}`)) continue
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
            host_name: e.calendly_user_name,
            event_type_name: e.event_type_name,
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
      for (const p of proposalsRes.value.data || []) {
        if (!p.accepted_at) continue
        if (dismissed.has(`accepted_proposal:${p.proposal_id}`)) continue
        const clientName =
          p.contact_full_name ||
          p.organization_name ||
          p.client_name ||
          "Client"
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
            currency: p.currency,
            client_name: clientName,
            proposal_url: p.signed_url,
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
