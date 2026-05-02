import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import {
  calendlyRequest,
  fetchMe,
  getAppBaseUrl,
  type CalendlyConnectionRow,
} from "@/lib/calendly-api"

/**
 * Manage Calendly webhook subscriptions. Unlike the previous version,
 * this endpoint operates on a *specific connection* (by `connectionId`)
 * and uses that connection's OAuth token, never a static access token.
 *
 *  POST   { connectionId, scope?, events? } → idempotent subscribe
 *  GET    ?connectionId=...                  → list subscriptions
 *  DELETE ?connectionId=...&id=...           → delete a subscription
 */

const DEFAULT_EVENTS = [
  "invitee.created",
  "invitee.canceled",
  "invitee_no_show.created",
  "invitee_no_show.deleted",
  "routing_form_submission.created",
]

async function loadConnection(connectionId: string) {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from("calendly_connections")
    .select("*")
    .eq("id", connectionId)
    .single()
  return { supabase, connection: (data as CalendlyConnectionRow | null) ?? null }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const { connectionId, events = DEFAULT_EVENTS, scope = "user" } = body
    if (!connectionId) {
      return NextResponse.json({ error: "connectionId required" }, { status: 400 })
    }

    const { supabase, connection } = await loadConnection(connectionId)
    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    // Refresh user metadata in case it's stale.
    const me = await fetchMe(connection, supabase)
    if (!me) {
      return NextResponse.json(
        { error: "Failed to fetch Calendly user — token may be invalid" },
        { status: 401 },
      )
    }

    const callbackUrl = `${getAppBaseUrl()}/api/calendly/webhook`

    // Idempotency: if a subscription pointing at our callback URL already
    // exists for this scope, return it instead of creating a duplicate.
    // Calendly returns 422 on duplicate URL+scope+user combinations.
    const list = await calendlyRequest<{ collection: any[] }>(
      connection,
      supabase,
      "/webhook_subscriptions",
      {
        query: {
          scope,
          user: scope === "user" ? me.uri : undefined,
          organization: me.current_organization,
          count: 100,
        },
      },
    )
    const existing = (list?.collection || []).find(
      (w) => w.callback_url === callbackUrl && w.state === "active",
    )
    if (existing) {
      return NextResponse.json({
        success: true,
        webhook: existing,
        webhookUrl: callbackUrl,
        existing: true,
      })
    }

    const created = await calendlyRequest<{ resource: any }>(
      connection,
      supabase,
      "/webhook_subscriptions",
      {
        method: "POST",
        body: {
          url: callbackUrl,
          events,
          scope,
          ...(scope === "user"
            ? { user: me.uri, organization: me.current_organization }
            : { organization: me.current_organization }),
        },
      },
    )

    return NextResponse.json({
      success: true,
      webhook: created?.resource,
      webhookUrl: callbackUrl,
    })
  } catch (err: any) {
    console.error("[calendly] webhook subscribe failed:", err)
    return NextResponse.json(
      { error: err?.message || "Failed to create webhook subscription" },
      { status: err?.status || 500 },
    )
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const connectionId = searchParams.get("connectionId")
    if (!connectionId) {
      return NextResponse.json({ error: "connectionId required" }, { status: 400 })
    }

    const { supabase, connection } = await loadConnection(connectionId)
    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    const me = await fetchMe(connection, supabase)
    if (!me) {
      return NextResponse.json(
        { webhooks: [], error: "Could not fetch Calendly user" },
        { status: 401 },
      )
    }

    const [orgRes, userRes] = await Promise.all([
      calendlyRequest<{ collection: any[] }>(connection, supabase, "/webhook_subscriptions", {
        query: { organization: me.current_organization, scope: "organization", count: 100 },
      }).catch(() => ({ collection: [] })),
      calendlyRequest<{ collection: any[] }>(connection, supabase, "/webhook_subscriptions", {
        query: {
          organization: me.current_organization,
          user: me.uri,
          scope: "user",
          count: 100,
        },
      }).catch(() => ({ collection: [] })),
    ])

    return NextResponse.json({
      webhooks: [...(orgRes?.collection || []), ...(userRes?.collection || [])],
      user: me,
    })
  } catch (err: any) {
    console.error("[calendly] list webhooks failed:", err)
    return NextResponse.json(
      { error: err?.message || "Failed to list webhooks" },
      { status: 500 },
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const connectionId = searchParams.get("connectionId")
    const webhookId = searchParams.get("id")
    if (!connectionId || !webhookId) {
      return NextResponse.json({ error: "connectionId and id required" }, { status: 400 })
    }

    const { supabase, connection } = await loadConnection(connectionId)
    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    await calendlyRequest(connection, supabase, `/webhook_subscriptions/${webhookId}`, {
      method: "DELETE",
    })
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error("[calendly] delete webhook failed:", err)
    return NextResponse.json(
      { error: err?.message || "Failed to delete webhook" },
      { status: 500 },
    )
  }
}
