import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { buildDebriefRequestHtml, sendCategoryEmail } from "@/lib/email"
import {
  buildDebriefPrefillUrl,
  meetingTypeLabel,
  resolveMeetingType,
  resolveMeetingDebriefRecipientIds,
  type MeetingSource,
} from "@/lib/debriefs/meeting-link"

/**
 * Hourly Vercel Cron that emails a debrief request after every client /
 * prospect meeting ends — ALFRED Ai's equivalent of Calendly's own
 * "meeting ended → here's your form" automation. Configured in vercel.json.
 *
 * For each Calendly event / Zoom meeting that:
 *   • ended within the last LOOKBACK_HOURS,
 *   • is not canceled,
 *   • is tagged to at least one client/prospect (contact or organization), and
 *   • has not already had a debrief requested (debrief_requested_at IS NULL),
 * we resolve the host + internal co-hosts and email each of them a link to
 * the prefilled /debriefs/new form. We then stamp debrief_requested_at so the
 * meeting is never emailed twice. Recipients who opted out of the
 * "meeting_debrief" category are skipped automatically by sendCategoryEmail.
 */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://hub.motta.cpa"
// How far back to look for newly-ended meetings. An hourly cron only needs ~1h
// but we use a buffer so a delayed Calendly/Zoom sync doesn't drop a meeting.
const LOOKBACK_HOURS = 3
// Zoom rows store start_time + duration (no end_time column). We widen the
// start_time scan window by this much so a long meeting that started earlier
// but ended recently is still considered.
const ZOOM_MAX_DURATION_HOURS = 6

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

/** First client tag on a meeting, normalized to { id, type, name }. */
function primaryClient(rows: any[] | null | undefined): {
  name: string | null
} {
  for (const r of rows || []) {
    if (r.contact_id || r.organization_id) {
      return { name: r.contact?.full_name || r.organization?.name || null }
    }
  }
  return { name: null }
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.CRON_SECRET && process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  try {
    const supabase = createAdminClient()
    const now = new Date()
    const lookbackStart = new Date(now.getTime() - LOOKBACK_HOURS * 60 * 60 * 1000)

    let totalSent = 0
    let totalSkipped = 0
    let meetingsProcessed = 0

    // ── Calendly ────────────────────────────────────────────────────────
    const { data: calendlyEvents, error: calErr } = await supabase
      .from("calendly_events")
      .select(
        `id, name, start_time, end_time, status, location_type, team_member_id,
         calendly_user_email, event_memberships, debrief_requested_at,
         calendly_event_clients ( contact_id, organization_id, contact:contacts ( full_name ), organization:organizations ( name ) )`,
      )
      .is("debrief_requested_at", null)
      .neq("status", "canceled")
      .gte("end_time", lookbackStart.toISOString())
      .lte("end_time", now.toISOString())

    if (calErr) throw calErr

    for (const ev of calendlyEvents || []) {
      const client = primaryClient(ev.calendly_event_clients)
      // Client/prospect meetings only — skip internal syncs / blocked time.
      if (!client.name && !(ev.calendly_event_clients || []).some((c: any) => c.contact_id || c.organization_id)) {
        continue
      }

      const recipientIds = await resolveMeetingDebriefRecipientIds(supabase, {
        source: "calendly",
        hostTeamMemberId: ev.team_member_id,
        hostEmail: ev.calendly_user_email,
        eventMemberships: ev.event_memberships,
      })

      const sent = await emailRecipients(supabase, {
        source: "calendly",
        meetingRowId: ev.id,
        meetingName: ev.name || "Calendly meeting",
        meetingStart: ev.start_time,
        locationType: ev.location_type,
        clientName: client.name,
        recipientIds,
      })
      totalSent += sent.sent
      totalSkipped += sent.skipped

      // Stamp regardless of send outcome so we don't retry a meeting whose
      // only recipients have opted out (they'd never get an email anyway).
      await supabase
        .from("calendly_events")
        .update({ debrief_requested_at: now.toISOString() })
        .eq("id", ev.id)
        .is("debrief_requested_at", null)
      meetingsProcessed++
    }

    // ── Zoom ────────────────────────────────────────────────────────────
    const zoomScanStart = new Date(
      now.getTime() - (LOOKBACK_HOURS + ZOOM_MAX_DURATION_HOURS) * 60 * 60 * 1000,
    )
    const { data: zoomMeetings, error: zoomErr } = await supabase
      .from("zoom_meetings")
      .select(
        `id, topic, start_time, duration, ended_at, status, team_member_id, host_email,
         debrief_requested_at,
         zoom_meeting_clients ( contact_id, organization_id, contact:contacts ( full_name ), organization:organizations ( name ) )`,
      )
      .is("debrief_requested_at", null)
      .gte("start_time", zoomScanStart.toISOString())

    if (zoomErr) throw zoomErr

    for (const m of zoomMeetings || []) {
      // Compute the actual end: prefer Zoom's reported ended_at, else
      // start_time + duration minutes.
      const start = new Date(m.start_time)
      const end = m.ended_at
        ? new Date(m.ended_at)
        : new Date(start.getTime() + (m.duration || 0) * 60 * 1000)
      // Only meetings that ended within the lookback window.
      if (end < lookbackStart || end > now) continue
      // Skip canceled / not-actually-held meetings.
      if (m.status && ["canceled", "cancelled", "deleted"].includes(String(m.status).toLowerCase())) continue

      const client = primaryClient(m.zoom_meeting_clients)
      if (!client.name && !(m.zoom_meeting_clients || []).some((c: any) => c.contact_id || c.organization_id)) {
        continue
      }

      const recipientIds = await resolveMeetingDebriefRecipientIds(supabase, {
        source: "zoom",
        hostTeamMemberId: m.team_member_id,
        hostEmail: m.host_email,
        eventMemberships: null,
      })

      const sent = await emailRecipients(supabase, {
        source: "zoom",
        meetingRowId: m.id,
        meetingName: m.topic || "Zoom meeting",
        meetingStart: m.start_time,
        locationType: null,
        clientName: client.name,
        recipientIds,
      })
      totalSent += sent.sent
      totalSkipped += sent.skipped

      await supabase
        .from("zoom_meetings")
        .update({ debrief_requested_at: now.toISOString() })
        .eq("id", m.id)
        .is("debrief_requested_at", null)
      meetingsProcessed++
    }

    return NextResponse.json({
      success: true,
      meetings_processed: meetingsProcessed,
      sent: totalSent,
      skipped: totalSkipped,
    })
  } catch (error) {
    console.error("[cron/debrief-reminder] Error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}

/**
 * Email each recipient their own prefilled debrief link (so the form defaults
 * the filer to them). Returns aggregate send/skip counts.
 */
async function emailRecipients(
  supabase: ReturnType<typeof createAdminClient>,
  args: {
    source: MeetingSource
    meetingRowId: string
    meetingName: string
    meetingStart: string
    locationType: string | null
    clientName: string | null
    recipientIds: string[]
  },
): Promise<{ sent: number; skipped: number }> {
  if (args.recipientIds.length === 0) return { sent: 0, skipped: 0 }

  const { data: members } = await supabase
    .from("team_members")
    .select("id, full_name, email, is_active")
    .in("id", args.recipientIds)

  const meetingType = resolveMeetingType(args.source, args.locationType)
  const typeLabel = meetingTypeLabel(meetingType)
  const meetingDate = args.meetingStart ? args.meetingStart.slice(0, 10) : null

  let sent = 0
  let skipped = 0

  for (const member of members || []) {
    if (!member.email || member.is_active === false) {
      skipped++
      continue
    }

    const debriefUrl = buildDebriefPrefillUrl(APP_URL, {
      source: args.source,
      meetingRowId: args.meetingRowId,
      meetingDate,
      meetingTitle: args.meetingName,
      meetingType,
      teamMemberId: member.id,
      teamMemberName: member.full_name,
    })

    const html = buildDebriefRequestHtml({
      recipientName: member.full_name?.split(" ")[0] || "there",
      meetingName: args.meetingName,
      meetingTime: formatWhen(args.meetingStart),
      meetingTypeLabel: typeLabel,
      clientName: args.clientName,
      debriefUrl,
    })

    const result = await sendCategoryEmail({
      category: "meeting_debrief",
      teamMemberIds: [member.id],
      subject: `Debrief needed: ${args.meetingName}`,
      html,
    })
    sent += result.sent
    skipped += result.skipped
  }

  return { sent, skipped }
}
