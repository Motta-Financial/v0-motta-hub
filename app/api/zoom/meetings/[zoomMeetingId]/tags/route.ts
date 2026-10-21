import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { ensureSessionRow, resolveMeetingRow } from "@/lib/zoom/meeting-occurrence"

/**
 * Per-meeting tags for Zoom meetings — clients (org or contact) and work items.
 *
 * The route is keyed on Zoom's own meeting id (the bigint that Zoom returns
 * in `meeting.id` from the API). We do NOT key on the internal Postgres
 * UUID (`zoom_meetings.id`) because the dashboard often reads meetings live
 * from Zoom's API and may not have synced the row yet — keying on the Zoom
 * id lets us upsert the parent row lazily on the first tag.
 *
 * The number alone does NOT name a meeting: a Personal Meeting Room and
 * every recurring meeting reuse it for every session, and tags are per
 * SESSION (one zoom_meetings row per Zoom uuid since migration 433). So
 * every call also says which session — `?uuid=` (or `meeting.uuid` in the
 * POST body), else `?start=` (the session's start time). A number that has
 * only ever held one session needs neither. When the session can't be told
 * apart, GET answers `{ ambiguous: true }` and writes are refused (409)
 * rather than tagging some other session.
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
  uuid?: string | null
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
 * Resolve the URL's bigint Zoom id + the caller's session hint to ONE
 * `zoom_meetings.id` (one session), optionally creating the session row
 * when the caller has provided enough metadata. Returns `internalId: null`
 * when no row exists and none could be created (GET renders an empty tag
 * list), and `ambiguous: true` when the number holds several sessions and
 * the hint doesn't pick one.
 */
async function resolveOrUpsertMeeting(
  zoomMeetingId: string,
  session: { uuid?: string | null; start?: string | null },
  meta?: MeetingMetadata,
  teamMemberId?: string | null,
) {
  const supabase = createAdminClient()
  const numericId = Number(zoomMeetingId)
  const uuid = session.uuid ?? meta?.uuid ?? null
  const start = session.start ?? meta?.start_time ?? null
  if (!Number.isFinite(numericId)) {
    return { supabase, internalId: null as string | null, ambiguous: false }
  }

  // A uuid names the session exactly: its row, or (with metadata) a new one
  // — never the number's other row, which is some other session.
  let ambiguous = false
  if (uuid) {
    const { data: exact } = await supabase.from("zoom_meetings").select("id").eq("zoom_uuid", uuid).maybeSingle()
    if (exact?.id) return { supabase, internalId: exact.id as string, ambiguous: false }
  } else {
    const resolved = await resolveMeetingRow(supabase, numericId, { start })
    if (resolved.row?.id) return { supabase, internalId: resolved.row.id, ambiguous: false }
    ambiguous = resolved.ambiguous
  }

  // No metadata provided -- caller can decide what to do (GET returns
  // empty tag arrays, POST returns an error). Without a uuid, an
  // ambiguous number can't get a new row either: we'd not know which
  // session it is.
  if (!meta || !meta.topic || ambiguous) {
    return { supabase, internalId: null as string | null, ambiguous }
  }

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

  if (uuid) {
    try {
      const row = await ensureSessionRow(supabase, {
        numericId,
        uuid,
        startTime: meta.start_time ?? null,
        duration: meta.duration ?? null,
        topic: meta.topic,
        hostEmail: meta.host_email ?? null,
        zoomHostId,
        teamMemberId: connTeamMemberId ?? teamMemberId ?? null,
        connectionId,
        timezone: meta.timezone ?? null,
        status: meta.status ?? null,
      })
      return { supabase, internalId: row?.id ?? null, ambiguous: false }
    } catch (err) {
      console.error("[v0] [Zoom Tags] session row upsert failed:", err)
      return { supabase, internalId: null as string | null, ambiguous: false }
    }
  }

  // No uuid and the number has no row yet: a first, uuid-less row (the
  // sync adopts it once it learns the uuid — see ensureSessionRow).
  const { data: inserted, error } = await supabase
    .from("zoom_meetings")
    .insert({
      zoom_meeting_id: numericId,
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
    })
    .select("id")
    .single()

  if (error) {
    console.error("[v0] [Zoom Tags] upsert parent failed:", error.message)
    return { supabase, internalId: null as string | null, ambiguous: false }
  }
  return { supabase, internalId: inserted?.id as string, ambiguous: false }
}

function sessionHint(req: NextRequest) {
  return {
    uuid: req.nextUrl.searchParams.get("uuid"),
    start: req.nextUrl.searchParams.get("start"),
  }
}

const AMBIGUOUS_ERROR =
  "This meeting number is shared by several sessions; pass ?uuid= (or ?start=) to say which one."

// ──────────────────────────────────────────────────────────────────────
// GET — list every tag for this meeting
// ──────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest, ctx: { params: Promise<{ zoomMeetingId: string }> }) {
  const { zoomMeetingId } = await ctx.params
  const { supabase, internalId, ambiguous } = await resolveOrUpsertMeeting(zoomMeetingId, sessionHint(req))

  // Empty tag set is the right answer when the parent meeting hasn't
  // been synced yet. The dialog will show "no tags yet" and POSTing
  // a tag will create the parent row lazily.
  if (!internalId) return NextResponse.json({ clients: [], workItems: [], deals: [], projects: [], ambiguous })

  const [clients, workItems, deals, projects] = await Promise.all([
    supabase
      .from("zoom_meeting_clients")
      .select(
        `id, link_source, match_method, confidence, alfred_reason, needs_review, contact:contacts ( id, full_name, primary_email ), organization:organizations ( id, name )`,
      )
      .eq("zoom_meeting_id", internalId)
      .order("created_at", { ascending: true }),
    supabase
      .from("zoom_meeting_work_items")
      .select(
        `id, link_source, match_method, confidence, alfred_reason, needs_review, work_item:work_items ( id, title, client_name, status, due_date )`,
      )
      .eq("zoom_meeting_id", internalId)
      .order("created_at", { ascending: true }),
    supabase
      .from("zoom_meeting_deals")
      .select(
        `id, link_source, match_method, confidence, alfred_reason, needs_review, deal:deals ( id, title, stage, status )`,
      )
      .eq("zoom_meeting_id", internalId)
      .order("created_at", { ascending: true }),
    supabase
      .from("zoom_meeting_projects")
      .select(
        `id, link_source, match_method, confidence, alfred_reason, needs_review, project:projects ( id, name, kind, status )`,
      )
      .eq("zoom_meeting_id", internalId)
      .order("created_at", { ascending: true }),
  ])

  return NextResponse.json({
    clients: clients.data || [],
    workItems: workItems.data || [],
    deals: deals.data || [],
    projects: projects.data || [],
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

  const { supabase, internalId, ambiguous } = await resolveOrUpsertMeeting(
    zoomMeetingId,
    sessionHint(req),
    meta,
    createdBy,
  )
  if (ambiguous) return NextResponse.json({ error: AMBIGUOUS_ERROR }, { status: 409 })
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
        `id, link_source, match_method, confidence, alfred_reason, needs_review, contact:contacts ( id, full_name, primary_email ), organization:organizations ( id, name )`,
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
        link_source: "manual",
        created_by_team_member_id: createdBy,
      })
      .select(
        `id, link_source, match_method, confidence, alfred_reason, needs_review, work_item:work_items ( id, title, client_name, status, due_date )`,
      )
      .single()
    if (error) {
      const status = (error as { code?: string }).code === "23505" ? 409 : 500
      return NextResponse.json({ error: error.message }, { status })
    }
    return NextResponse.json({ tag: data })
  }

  if (kind === "deal") {
    const dealId: string | null = body.dealId ?? null
    if (!dealId) {
      return NextResponse.json({ error: "dealId required" }, { status: 400 })
    }
    const { data, error } = await supabase
      .from("zoom_meeting_deals")
      .insert({
        zoom_meeting_id: internalId,
        deal_id: dealId,
        link_source: "manual",
        created_by_team_member_id: createdBy,
      })
      .select(
        `id, link_source, match_method, confidence, alfred_reason, needs_review, deal:deals ( id, title, stage, status )`,
      )
      .single()
    if (error) {
      const status = (error as { code?: string }).code === "23505" ? 409 : 500
      return NextResponse.json({ error: error.message }, { status })
    }
    return NextResponse.json({ tag: data })
  }

  if (kind === "project") {
    const projectId: string | null = body.projectId ?? null
    if (!projectId) {
      return NextResponse.json({ error: "projectId required" }, { status: 400 })
    }
    const { data, error } = await supabase
      .from("zoom_meeting_projects")
      .insert({
        zoom_meeting_id: internalId,
        project_id: projectId,
        link_source: "manual",
        created_by_team_member_id: createdBy,
      })
      .select(
        `id, link_source, match_method, confidence, alfred_reason, needs_review, project:projects ( id, name, kind, status )`,
      )
      .single()
    if (error) {
      const status = (error as { code?: string }).code === "23505" ? 409 : 500
      return NextResponse.json({ error: error.message }, { status })
    }
    return NextResponse.json({ tag: data })
  }

  return NextResponse.json(
    { error: "kind must be client | work_item | deal | project" },
    { status: 400 },
  )
}

// ──────────────────────────────────────────────────────────────────────
// DELETE — remove a tag
// ──────────────────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ zoomMeetingId: string }> }) {
  const { zoomMeetingId } = await ctx.params
  const { supabase, internalId, ambiguous } = await resolveOrUpsertMeeting(zoomMeetingId, sessionHint(req))
  if (ambiguous) return NextResponse.json({ error: AMBIGUOUS_ERROR }, { status: 409 })
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
        : kind === "deal"
          ? "zoom_meeting_deals"
          : kind === "project"
            ? "zoom_meeting_projects"
            : null
  if (!table) {
    return NextResponse.json(
      { error: "kind must be client | work_item | deal | project" },
      { status: 400 },
    )
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
