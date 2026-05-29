import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * Debrief <-> meeting linking API, used by the meeting detail dialog.
 *
 * GET  ?calendly_event_id= | ?zoom_meeting_id=
 *      -> { linked: Debrief | null, candidates: Debrief[] }
 *      `linked` is the debrief already attached to this meeting (if any).
 *      `candidates` are recent, not-yet-linked debriefs the user can attach,
 *      preferring ones tagged to the same client as the meeting.
 *
 * POST { debrief_id, calendly_event_id? , zoom_meeting_id? }
 *      -> attaches an existing debrief to the meeting (and stamps the
 *         meeting so the reminder cron skips it). Pass debrief_id only with
 *         exactly one meeting id.
 */

const CANDIDATE_DAYS = 60
const CANDIDATE_LIMIT = 25

const DEBRIEF_FIELDS =
  "id, debrief_date, debrief_type, status, notes, contact_id, organization_id, organization_name, team_member_id, calendly_event_id, zoom_meeting_id, contacts:contact_id (full_name), team_member:team_member_id (full_name)"

function shape(d: any) {
  if (!d) return d
  return {
    id: d.id,
    debrief_date: d.debrief_date,
    debrief_type: d.debrief_type,
    status: d.status,
    notes: d.notes,
    contact_id: d.contact_id,
    organization_id: d.organization_id,
    contact_full_name: d.contacts?.full_name || null,
    organization_name: d.organization_name || null,
    team_member_full_name: d.team_member?.full_name || null,
    calendly_event_id: d.calendly_event_id,
    zoom_meeting_id: d.zoom_meeting_id,
  }
}

export async function GET(request: NextRequest) {
  const supabase = createAdminClient()
  const sp = request.nextUrl.searchParams
  const calendlyEventId = sp.get("calendly_event_id")
  const zoomMeetingId = sp.get("zoom_meeting_id")

  if (!calendlyEventId && !zoomMeetingId) {
    return NextResponse.json({ error: "calendly_event_id or zoom_meeting_id is required" }, { status: 400 })
  }

  // 1. Already-linked debrief for this meeting.
  const linkedQuery = supabase.from("debriefs").select(DEBRIEF_FIELDS)
  const { data: linkedRows, error: linkedErr } = await (calendlyEventId
    ? linkedQuery.eq("calendly_event_id", calendlyEventId)
    : linkedQuery.eq("zoom_meeting_id", zoomMeetingId!)
  ).limit(1)

  if (linkedErr) {
    return NextResponse.json({ error: linkedErr.message }, { status: 500 })
  }
  const linked = linkedRows && linkedRows.length > 0 ? shape(linkedRows[0]) : null

  // 2. Resolve the meeting's client (contact/org) to prioritize candidates.
  const clientTable = calendlyEventId ? "calendly_event_clients" : "zoom_meeting_clients"
  const clientFk = calendlyEventId ? "calendly_event_id" : "zoom_meeting_id"
  const clientFkValue = calendlyEventId || zoomMeetingId!
  const { data: clientRows } = await supabase
    .from(clientTable)
    .select("contact_id, organization_id")
    .eq(clientFk, clientFkValue)

  const contactIds = new Set<string>()
  const orgIds = new Set<string>()
  for (const r of clientRows || []) {
    if (r.contact_id) contactIds.add(r.contact_id)
    if (r.organization_id) orgIds.add(r.organization_id)
  }

  // 3. Candidate debriefs: recent, not yet linked to ANY meeting.
  const sinceIso = new Date(Date.now() - CANDIDATE_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0]

  let candQuery = supabase
    .from("debriefs")
    .select(DEBRIEF_FIELDS)
    .is("calendly_event_id", null)
    .is("zoom_meeting_id", null)
    .gte("debrief_date", sinceIso)
    .order("debrief_date", { ascending: false })
    .limit(CANDIDATE_LIMIT)

  // Prefer same-client debriefs when we know the client; otherwise show all
  // recent unlinked debriefs so the user can still attach one manually.
  if (contactIds.size > 0 || orgIds.size > 0) {
    const ors: string[] = []
    for (const id of contactIds) ors.push(`contact_id.eq.${id}`)
    for (const id of orgIds) ors.push(`organization_id.eq.${id}`)
    candQuery = candQuery.or(ors.join(","))
  }

  const { data: candRows, error: candErr } = await candQuery
  if (candErr) {
    return NextResponse.json({ error: candErr.message }, { status: 500 })
  }

  return NextResponse.json({
    linked,
    candidates: (candRows || []).map(shape),
  })
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()
    const debriefId: string | undefined = body.debrief_id
    const calendlyEventId: string | null = body.calendly_event_id || null
    const zoomMeetingId: string | null = body.zoom_meeting_id || null

    if (!debriefId) {
      return NextResponse.json({ error: "debrief_id is required" }, { status: 400 })
    }
    if (!calendlyEventId && !zoomMeetingId) {
      return NextResponse.json({ error: "calendly_event_id or zoom_meeting_id is required" }, { status: 400 })
    }
    if (calendlyEventId && zoomMeetingId) {
      return NextResponse.json({ error: "Provide only one meeting id" }, { status: 400 })
    }

    // Attach the debrief to the meeting (and clear the opposite link in case
    // it was previously linked to the other meeting type).
    const { data: updated, error: updateErr } = await supabase
      .from("debriefs")
      .update({
        calendly_event_id: calendlyEventId,
        zoom_meeting_id: zoomMeetingId,
      })
      .eq("id", debriefId)
      .select(DEBRIEF_FIELDS)

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: "Debrief not found" }, { status: 404 })
    }

    // Stamp the meeting so the hourly reminder cron treats it as handled.
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

    return NextResponse.json({ debrief: shape(updated[0]) })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
