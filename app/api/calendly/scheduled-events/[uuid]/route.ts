import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { calendlyRequest, type CalendlyConnectionRow } from "@/lib/calendly-api"

/**
 * Per-event actions on Calendly scheduled events. Requires
 * `scheduled_events:write`.
 *
 *  GET                              → fetch event detail
 *  POST  { action: "cancel", reason? }  → cancel the event
 *  POST  { action: "no_show", inviteeUri } → mark an invitee as no-show
 *  POST  { action: "clear_no_show", noShowUri } → undo a no-show
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await params
  const connection = await resolveConnectionByEvent(uuid)
  if (!connection.connection) {
    return NextResponse.json({ error: "No connection found" }, { status: 404 })
  }
  try {
    const result = await calendlyRequest<{ resource: any }>(
      connection.connection,
      connection.supabase,
      `/scheduled_events/${uuid}`,
    )
    return NextResponse.json(result?.resource ?? null)
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to fetch event" },
      { status: err?.status || 500 },
    )
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ uuid: string }> },
) {
  const { uuid } = await params
  const body = await request.json().catch(() => ({}))
  const action = body.action
  const { connection, supabase } = await resolveConnectionByEvent(uuid)
  if (!connection) {
    return NextResponse.json({ error: "No connection found" }, { status: 404 })
  }

  try {
    if (action === "cancel") {
      const result = await calendlyRequest<{ resource: any }>(
        connection,
        supabase,
        `/scheduled_events/${uuid}/cancellation`,
        { method: "POST", body: { reason: body.reason ?? "" } },
      )
      // Mirror cancellation locally so the dashboard reflects it instantly.
      await supabase
        .from("calendly_events")
        .update({
          status: "canceled",
          canceled_at: new Date().toISOString(),
          cancel_reason: body.reason ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("calendly_uuid", uuid)
      return NextResponse.json({ cancellation: result?.resource ?? null })
    }

    if (action === "no_show") {
      if (!body.inviteeUri) {
        return NextResponse.json({ error: "inviteeUri required" }, { status: 400 })
      }
      const result = await calendlyRequest<{ resource: any }>(
        connection,
        supabase,
        `/invitee_no_shows`,
        { method: "POST", body: { invitee: body.inviteeUri } },
      )
      return NextResponse.json({ noShow: result?.resource ?? null })
    }

    if (action === "clear_no_show") {
      if (!body.noShowUri) {
        return NextResponse.json({ error: "noShowUri required" }, { status: 400 })
      }
      const noShowUuid = body.noShowUri.split("/").pop()
      await calendlyRequest(
        connection,
        supabase,
        `/invitee_no_shows/${noShowUuid}`,
        { method: "DELETE" },
      )
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  } catch (err: any) {
    console.error("[calendly] event action failed:", err)
    return NextResponse.json(
      { error: err?.message || "Action failed" },
      { status: err?.status || 500 },
    )
  }
}

async function resolveConnectionByEvent(eventUuid: string) {
  const supabase = await createClient()
  // Find the connection that hosts the event.
  const { data: row } = await supabase
    .from("calendly_events")
    .select("calendly_connection_id, calendly_user_uri")
    .eq("calendly_uuid", eventUuid)
    .maybeSingle()

  let connection: CalendlyConnectionRow | null = null
  if (row?.calendly_connection_id) {
    const { data } = await supabase
      .from("calendly_connections")
      .select("*")
      .eq("id", row.calendly_connection_id)
      .eq("is_active", true)
      .maybeSingle()
    connection = (data as CalendlyConnectionRow | null) ?? null
  }
  if (!connection && row?.calendly_user_uri) {
    const { data } = await supabase
      .from("calendly_connections")
      .select("*")
      .eq("calendly_user_uri", row.calendly_user_uri)
      .eq("is_active", true)
      .maybeSingle()
    connection = (data as CalendlyConnectionRow | null) ?? null
  }
  // Last resort: caller's own connection.
  if (!connection) {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) {
      const { data: tm } = await supabase
        .from("team_members")
        .select("id")
        .eq("auth_user_id", user.id)
        .single()
      if (tm) {
        const { data } = await supabase
          .from("calendly_connections")
          .select("*")
          .eq("team_member_id", tm.id)
          .eq("is_active", true)
          .maybeSingle()
        connection = (data as CalendlyConnectionRow | null) ?? null
      }
    }
  }
  return { supabase, connection }
}
