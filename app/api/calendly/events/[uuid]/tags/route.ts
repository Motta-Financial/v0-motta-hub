import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * Per-event tags: clients (org or contact), work items, and services.
 *
 * The route is keyed on `calendly_uuid` (Calendly's own identifier) so
 * the URL is stable across DB rebuilds — internal `id` UUIDs change if
 * a row gets re-synced from scratch.
 *
 *   GET    → returns every tag attached to the event
 *   POST   → adds a tag, body shape:
 *              { kind: 'client',    contactId | organizationId }
 *              { kind: 'work_item', workItemId }
 *              { kind: 'service',   serviceId }
 *   DELETE → ?kind=client|work_item|service&id=<row id>
 */

async function resolveEventId(uuid: string) {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from("calendly_events")
    .select("id")
    .eq("calendly_uuid", uuid)
    .maybeSingle()
  return { supabase, eventId: data?.id ?? null }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await ctx.params
  const { supabase, eventId } = await resolveEventId(uuid)
  if (!eventId) return NextResponse.json({ error: "Event not found" }, { status: 404 })

  const [clients, workItems, services] = await Promise.all([
    supabase
      .from("calendly_event_clients")
      .select(
        `id, link_source, match_method, contact:contacts ( id, full_name, primary_email ), organization:organizations ( id, name )`,
      )
      .eq("calendly_event_id", eventId)
      .order("created_at", { ascending: true }),
    supabase
      .from("calendly_event_work_items")
      .select(`id, work_item:work_items ( id, title, client_name, status, due_date )`)
      .eq("calendly_event_id", eventId)
      .order("created_at", { ascending: true }),
    supabase
      .from("calendly_event_services")
      .select(`id, service:services ( id, name, category )`)
      .eq("calendly_event_id", eventId)
      .order("created_at", { ascending: true }),
  ])

  return NextResponse.json({
    clients: clients.data || [],
    workItems: workItems.data || [],
    services: services.data || [],
  })
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await ctx.params
  const body = await req.json().catch(() => ({}))
  const { supabase, eventId } = await resolveEventId(uuid)
  if (!eventId) return NextResponse.json({ error: "Event not found" }, { status: 404 })

  const kind: string | undefined = body.kind
  const createdBy: string | null = body.teamMemberId ?? null

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
      .from("calendly_event_clients")
      .insert({
        calendly_event_id: eventId,
        contact_id: contactId,
        organization_id: organizationId,
        link_source: "manual",
        created_by_team_member_id: createdBy,
      })
      .select(
        `id, link_source, match_method, contact:contacts ( id, full_name, primary_email ), organization:organizations ( id, name )`,
      )
      .single()
    // Map unique-violation to a friendly 409 so the UI can show "already
    // tagged" instead of a generic 500.
    if (error) {
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
      .from("calendly_event_work_items")
      .insert({
        calendly_event_id: eventId,
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

  if (kind === "service") {
    const serviceId: string | null = body.serviceId ?? null
    if (!serviceId) {
      return NextResponse.json({ error: "serviceId required" }, { status: 400 })
    }
    const { data, error } = await supabase
      .from("calendly_event_services")
      .insert({
        calendly_event_id: eventId,
        service_id: serviceId,
        created_by_team_member_id: createdBy,
      })
      .select(`id, service:services ( id, name, category )`)
      .single()
    if (error) {
      const status = (error as { code?: string }).code === "23505" ? 409 : 500
      return NextResponse.json({ error: error.message }, { status })
    }
    return NextResponse.json({ tag: data })
  }

  return NextResponse.json({ error: "kind must be client | work_item | service" }, { status: 400 })
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await ctx.params
  const { supabase, eventId } = await resolveEventId(uuid)
  if (!eventId) return NextResponse.json({ error: "Event not found" }, { status: 404 })

  const sp = req.nextUrl.searchParams
  const kind = sp.get("kind")
  const id = sp.get("id")
  if (!kind || !id) {
    return NextResponse.json({ error: "kind and id query params required" }, { status: 400 })
  }
  const table =
    kind === "client"
      ? "calendly_event_clients"
      : kind === "work_item"
        ? "calendly_event_work_items"
        : kind === "service"
          ? "calendly_event_services"
          : null
  if (!table) {
    return NextResponse.json({ error: "kind must be client | work_item | service" }, { status: 400 })
  }

  // Scope the delete to this event so a stray id from a different event
  // can't be removed by accident.
  const { error } = await supabase
    .from(table)
    .delete()
    .eq("id", id)
    .eq("calendly_event_id", eventId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
