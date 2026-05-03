import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import {
  calendlyRequest,
  ensureWebhookSubscription,
  fetchMe,
  type CalendlyConnectionRow,
} from "@/lib/calendly-api"

/**
 * Manage Calendly webhook subscriptions. This endpoint operates on a
 * *specific connection* (by `connectionId`) and uses that connection's
 * OAuth token, never a static access token.
 *
 *  POST   { connectionId, scope?, events? } → idempotent subscribe
 *  GET    ?connectionId=...                  → list subscriptions
 *  DELETE ?connectionId=...&id=...           → delete a subscription
 */

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
    const { connectionId, events, scope = "user" } = body
    if (!connectionId) {
      return NextResponse.json({ error: "connectionId required" }, { status: 400 })
    }

    const { supabase, connection } = await loadConnection(connectionId)
    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    // Delegate to the shared helper so the OAuth callback and the manual
    // "Subscribe" button in the diagnostics UI behave identically and
    // both persist `webhook_subscribed`/`webhook_subscription_uri` to the
    // DB. Returns the webhook resource (existing or newly created), or
    // an error string we can surface to the user.
    const result = await ensureWebhookSubscription(connection, supabase, {
      scope,
      events,
    })

    if (result.error || !result.webhook) {
      return NextResponse.json(
        { error: result.error || "Failed to create webhook subscription" },
        { status: 502 },
      )
    }

    return NextResponse.json({
      success: true,
      webhook: result.webhook,
      webhookUrl: result.callbackUrl,
      existing: result.reused,
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
