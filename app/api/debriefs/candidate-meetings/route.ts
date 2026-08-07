/**
 * GET /api/debriefs/candidate-meetings?contact_id=&organization_id=&days=
 *
 * Meetings that have happened and don't have a debrief yet — the list
 * behind the "Which meeting was this?" picker on the debrief form.
 *
 * Why this exists: 0 of 915 debriefs were linked to a meeting, not
 * because the plumbing was broken (it wasn't) but because the link only
 * existed when someone arrived via a prefilled URL. Anyone clicking
 * "New Debrief" got a bare form that never asked. The reminder email now
 * carries the link for the meetings it covers; this covers everyone else.
 *
 * ── Every modality, deliberately ─────────────────────────────────────
 * Phone and in-person meetings are included. They produce no recording,
 * no transcript and no AI summary, so nothing pre-populates — but the
 * firm's rule is a debrief for EVERY meeting, and a picker that quietly
 * omitted the un-recorded ones would make the un-recorded ones the easy
 * ones to skip. `has_artifacts` tells the UI which will arrive with a
 * draft, without hiding the others.
 *
 * Auth-gated: returns client meeting titles.
 */

import { type NextRequest, NextResponse } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { getAuthenticatedUser } from "@/lib/supabase/auth-helpers"
import { resolveMeetingType, meetingTypeLabel } from "@/lib/debriefs/meeting-link"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** How far back to offer meetings, by default. */
const DEFAULT_DAYS = 30
const MAX_DAYS = 180
const MAX_RESULTS = 40

export interface CandidateMeeting {
  source: "calendly" | "zoom"
  meeting_row_id: string
  title: string
  start_time: string | null
  meeting_type: "zoom" | "phone" | "in_person"
  meeting_type_label: string
  client_name: string | null
  contact_id: string | null
  organization_id: string | null
  /** True when a recording/transcript/summary exists to draft from. */
  has_artifacts: boolean
}

export async function GET(req: NextRequest) {
  const authClient = await createClient()
  const {
    data: { user },
  } = await getAuthenticatedUser(authClient)
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const contactId = sp.get("contact_id")
  const organizationId = sp.get("organization_id")
  const days = Math.min(Number(sp.get("days")) || DEFAULT_DAYS, MAX_DAYS)

  const supabase = createAdminClient()
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const now = new Date().toISOString()

  try {
    // Debriefs already filed, so we can exclude their meetings. Cheaper as
    // one upfront read than a NOT EXISTS per row.
    const { data: taken } = await supabase
      .from("debriefs")
      .select("calendly_event_id, zoom_meeting_id")
      .is("deleted_at", null)
      .or("calendly_event_id.not.is.null,zoom_meeting_id.not.is.null")
    const takenCalendly = new Set(
      (taken ?? []).map((d) => d.calendly_event_id).filter(Boolean) as string[],
    )
    const takenZoom = new Set(
      (taken ?? []).map((d) => d.zoom_meeting_id).filter(Boolean) as string[],
    )

    let calendlyQ = supabase
      .from("calendly_events")
      .select(
        `id, name, start_time, end_time, location_type, status,
         calendly_event_clients ( contact_id, organization_id, contact:contacts ( full_name ), organization:organizations ( name ) )`,
      )
      .neq("status", "canceled")
      .gte("start_time", since)
      .lte("start_time", now)
      .order("start_time", { ascending: false })
      .limit(MAX_RESULTS)

    let zoomQ = supabase
      .from("zoom_meetings")
      .select(
        `id, topic, start_time, status,
         zoom_meeting_clients ( contact_id, organization_id, contact:contacts ( full_name ), organization:organizations ( name ) )`,
      )
      .gte("start_time", since)
      .lte("start_time", now)
      .order("start_time", { ascending: false })
      .limit(MAX_RESULTS)

    const [calRes, zoomRes] = await Promise.all([calendlyQ, zoomQ])

    const out: CandidateMeeting[] = []

    const matchesFilter = (cid: string | null, oid: string | null) => {
      if (!contactId && !organizationId) return true
      if (contactId && cid === contactId) return true
      if (organizationId && oid === organizationId) return true
      return false
    }

    for (const ev of calRes.data ?? []) {
      if (takenCalendly.has(ev.id)) continue
      const tag = (ev.calendly_event_clients as any[])?.[0]
      const cid = tag?.contact_id ?? null
      const oid = tag?.organization_id ?? null
      if (!matchesFilter(cid, oid)) continue
      const type = resolveMeetingType("calendly", ev.location_type as string | null)
      out.push({
        source: "calendly",
        meeting_row_id: ev.id,
        title: (ev.name as string) || "Calendly meeting",
        start_time: (ev.start_time as string) ?? null,
        meeting_type: type,
        meeting_type_label: meetingTypeLabel(type),
        client_name: tag?.contact?.full_name ?? tag?.organization?.name ?? null,
        contact_id: cid,
        organization_id: oid,
        // A Calendly booking's artifacts live on the bridged Zoom row; we
        // don't resolve that here (it'd be a query per row). The form
        // fetches the real context once the user picks one.
        has_artifacts: type === "zoom",
      })
    }

    for (const m of zoomRes.data ?? []) {
      if (takenZoom.has(m.id)) continue
      if (m.status && ["canceled", "cancelled", "deleted"].includes(String(m.status).toLowerCase())) {
        continue
      }
      const tag = (m.zoom_meeting_clients as any[])?.[0]
      const cid = tag?.contact_id ?? null
      const oid = tag?.organization_id ?? null
      if (!matchesFilter(cid, oid)) continue
      out.push({
        source: "zoom",
        meeting_row_id: m.id,
        title: (m.topic as string) || "Zoom meeting",
        start_time: (m.start_time as string) ?? null,
        meeting_type: "zoom",
        meeting_type_label: "Zoom",
        client_name: tag?.contact?.full_name ?? tag?.organization?.name ?? null,
        contact_id: cid,
        organization_id: oid,
        has_artifacts: true,
      })
    }

    // A Calendly booking and the Zoom meeting it created are the same
    // event from the user's point of view; offering both would invite
    // filing two debriefs for one conversation. Prefer the Calendly row
    // (it carries the client tag and the event type name), and drop the
    // Zoom row it bridged to.
    const bridged = new Set<string>()
    if (out.some((m) => m.source === "calendly")) {
      const calIds = out.filter((m) => m.source === "calendly").map((m) => m.meeting_row_id)
      if (calIds.length > 0) {
        const { data: zm } = await supabase
          .from("zoom_meetings")
          .select("id, calendly_event_id")
          .in("calendly_event_id", calIds)
        for (const z of zm ?? []) bridged.add(z.id as string)
      }
    }

    const deduped = out.filter((m) => !(m.source === "zoom" && bridged.has(m.meeting_row_id)))
    deduped.sort((a, b) => (b.start_time ?? "").localeCompare(a.start_time ?? ""))

    return NextResponse.json({ meetings: deduped.slice(0, MAX_RESULTS) })
  } catch (err) {
    console.error("[debriefs/candidate-meetings] failed:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    )
  }
}
