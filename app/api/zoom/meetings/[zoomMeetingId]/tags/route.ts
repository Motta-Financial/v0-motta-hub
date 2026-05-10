import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * Per-meeting tags for Zoom meetings — clients (org or contact) and work items.
 *
 * The route is keyed on Zoom's own meeting id (the bigint that Zoom returns
 * in `meeting.id` from the API). We do NOT key on the internal Postgres
 * UUID (`zoom_meetings.id`) because the dashboard often reads meetings live
 * from Zoom's API and may not have synced the row yet — keying on the Zoom
 * id lets us upsert the parent row lazily on the first tag.
 *
 * The numeric id arrives as a string in the URL because Next.js route
 * params are always strings; we keep it as a string when comparing because
 * `zoom_meetings.zoom_meeting_id` is `bigint` and Postgres will widen the
 * literal correctly.
 *
 *   GET    → returns every tag attached to the meeting
 *   POST   → adds a tag, body shape:
 *              { kind: 'client',    contactId | organizationId, meeting?: <metadata> }
 *              { kind: 'work_item', workItemId,                meeting?: <metadata> }
 *            `meeting` is OPTIONAL but recommended — when present we upsert
 *            the parent `zoom_meetings` row so a user can tag a meeting
 *            even if the master sync hasn't run yet.
 *   DELETE → ?kind=client|work_item&id=<junction row id>
 */

interface MeetingMetadata {
  topic?: string | null
  start_time?: string | null
  duration?: number | null
  timezone?: string | null
  agenda?: string | null
  join_url?: string | null
  host_email?: string | null
  host_id?: string | null
  status?: string | null
}

/**
 * Resolve the URL's bigint Zoom id to the internal `zoom_meetings.id` UUID,
 * optionally upserting a parent row when the caller has provided enough
 * metadata. Returns `null` when no row exists and no metadata was provided
 * (so GET can render an empty tag list rather than 404).
 */
async function resolveOrUpsertMeeting(
  zoomMeetingId: string,
  meta?: MeetingMetadata,
  teamMemberId?: string | null,
) {
  const supabase = createAdminClient()

  // bigint comparison — pass as string, Postgres will coerce.
  const { data: existing } = await supabase
    .from("zoom_meetings")
    .select("id")
    .eq("zoom_meeting_id", zoomMeetingId)
    .maybeSingle()

  if (existing?.id) return { supabase, internalId: existing.id as string }

  // No metadata provided -- caller can decide what to do (GET returns
  // empty tag arrays, POST returns an error).
  if (!meta || !meta.topic) return { supabase, internalId: null as string | null }

  // Look up the Zoom connection for the host so the upsert carries
  // the right `team_member_id` / `zoom_connection_id` / `zoom_host_id`
  // fields. This keeps RLS-style filters elsewhere in the codebase
  // working correctly.
  let connectionId: string | null = null
  let connTeamMemberId: string | null = null
  let zoomHostId: string | null = meta.host_id ?? null
  if (meta.host_email) {
    const { data: conn } = await supabase
      .from("zoom_connections")
      .select("id, team_member_id, zoom_user_id")
      .ilike("zoom_email", meta.host_email)
      .maybeSingle()
    if (conn) {
      connectionId = conn.id
      connTeamMemberId = conn.team_member_id
      if (!zoomHostId) zoomHostId = conn.zoom_user_id
    }
  }

  const { data: inserted, error } = await supabase
    .from("zoom_meetings")
    .upsert(
      {
        zoom_meeting_id: zoomMeetingId,
        topic: meta.topic,
        start_time: meta.start_time ?? null,
        duration: meta.duration ?? null,
        timezone: meta.timezone ?? null,
        agenda: meta.agenda ?? null,
        join_url: meta.join_url ?? null,
        host_email: meta.host_email ?? null,
        zoom_host_id: zoomHostId,
        status: meta.status ?? null,
        zoom_connection_id: connectionId,
        team_member_id: connTeamMemberId ?? teamMemberId ?? null,
        synced_at: new Date().toISOString(),
      },
      { onConflict: "zoom_meeting_id" },
    )
    .select("id")
    .single()

  if (error) {
    console.error("[v0] [Zoom Tags] upsert parent failed:", error.message)
    return { supabase, internalId: null as string | null }
  }
  return { supabase, internalId: inserted?.id as string }
}

// ──────────────────────────────────────────────────────────────────────
// GET — list every tag for this meeting
// ──────────────────────────────────────────────────────────────────────
export async function GET(_req: NextRequest, ctx: { params: Promise<{ zoomMeetingId: string }> }) {
  const { zoomMeetingId } = await ctx.params
  const { supabase, internalId } = await resolveOrUpsertMeeting(zoomMeetingId)

  // Empty tag set is the right answer when the parent meeting hasn't
  // been synced yet. The dialog will show "no tags yet" and POSTing
  // a tag will create the parent row lazily.
  if (!internalId) return NextResponse.json({ clients: [], workItems: [] })

  const [clients, workItems] = await Promise.all([
    supabase
      .from("zoom_meeting_clients")
      .select(
        `id, link_source, match_method, contact:contacts ( id, full_name, primary_email ), organization:organizations ( id, name )`,
      )
      .eq("zoom_meeting_id", internalId)
      .order("created_at", { ascending: true }),
    supabase
      .from("zoom_meeting_work_items")
      .select(`id, work_item:work_items ( id, title, client_name, status, due_date )`)
      .eq("zoom_meeting_id", internalId)
      .order("created_at", { ascending: true }),
  ])

  return NextResponse.json({
    clients: clients.data || [],
    workItems: workItems.data || [],
  })
}

// ──────────────────────────────────────────────────────────────────────
// POST — add a single tag
// ──────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest, ctx: { params: Promise<{ zoomMeetingId: string }> }) {
  const { zoomMeetingId } = await ctx.params
  const body = await req.json().catch(() => ({}))

  const kind: string | undefined = body.kind
  const createdBy: string | null = body.teamMemberId ?? null
  const meta: MeetingMetadata | undefined = body.meeting

  const { supabase, internalId } = await resolveOrUpsertMeeting(zoomMeetingId, meta, createdBy)
  if (!internalId) {
    return NextResponse.json(
      {
        error:
          "Meeting not found. Pass `meeting: { topic, start_time, host_email, ... }` in the body to upsert it lazily.",
      },
      { status: 404 },
    )
  }

  if (kind === "client") {
    const contactId: string | null = body.contactId ?? null
    const organizationId: string | null = body.organizationId ?? null
    if (!contactId && !organizationId) {
      return NextResponse.json({ error: "contactId or organizationId required" }, { status: 400 })
    }
    if (contactId && organizationId) {
      return NextResponse.json(
        { error: "specify exactly one of contactId or organizationId" },
        { status: 400 },
      )
    }
    const { data, error } = await supabase
      .from("zoom_meeting_clients")
      .insert({
        zoom_meeting_id: internalId,
        contact_id: contactId,
        organization_id: organizationId,
        link_source: "manual",
        created_by_team_member_id: createdBy,
      })
      .select(
        `id, link_source, match_method, contact:contacts ( id, full_name, primary_email ), organization:organizations ( id, name )`,
      )
      .single()
    if (error) {
      // Friendly 409 on the partial-unique indexes (one for contact,
      // one for organization). Anything else is a real 500.
      const status = (error as { code?: string }).code === "23505" ? 409 : 500
      return NextResponse.json({ error: error.message }, { status })
    }
    return NextResponse.json({ tag: data })
  }

  if (kind === "work_item") {
    const workItemId: string | null = body.workItemId ?? null
    if (!workItemId) {
      return NextResponse.json({ error: "workItemId required" }, { status: 400 })
    }
    const { data, error } = await supabase
      .from("zoom_meeting_work_items")
      .insert({
        zoom_meeting_id: internalId,
        work_item_id: workItemId,
        created_by_team_member_id: createdBy,
      })
      .select(`id, work_item:work_items ( id, title, client_name, status, due_date )`)
      .single()
    if (error) {
      const status = (error as { code?: string }).code === "23505" ? 409 : 500
      return NextResponse.json({ error: error.message }, { status })
    }
    return NextResponse.json({ tag: data })
  }

  return NextResponse.json({ error: "kind must be client | work_item" }, { status: 400 })
}

// ──────────────────────────────────────────────────────────────────────
// DELETE — remove a tag
// ──────────────────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ zoomMeetingId: string }> }) {
  const { zoomMeetingId } = await ctx.params
  const { supabase, internalId } = await resolveOrUpsertMeeting(zoomMeetingId)
  if (!internalId) return NextResponse.json({ error: "Meeting not found" }, { status: 404 })

  const sp = req.nextUrl.searchParams
  const kind = sp.get("kind")
  const id = sp.get("id")
  if (!kind || !id) {
    return NextResponse.json({ error: "kind and id query params required" }, { status: 400 })
  }
  const table =
    kind === "client"
      ? "zoom_meeting_clients"
      : kind === "work_item"
        ? "zoom_meeting_work_items"
        : null
  if (!table) {
    return NextResponse.json({ error: "kind must be client | work_item" }, { status: 400 })
  }

  // Scope the delete to this meeting so a stray junction id from a
  // different meeting can't be removed by accident.
  const { error } = await supabase
    .from(table)
    .delete()
    .eq("id", id)
    .eq("zoom_meeting_id", internalId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
