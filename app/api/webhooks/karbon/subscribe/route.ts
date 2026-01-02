/**
 * Karbon Webhook Subscription Manager
 * Register/unregister webhooks with Karbon API
 *
 * POST - Create a new webhook subscription
 * DELETE - Remove a webhook subscription
 * GET - List current subscriptions
 */
import { type NextRequest, NextResponse } from "next/server"
import { getKarbonCredentials, karbonFetch } from "@/lib/karbon-api"

const WEBHOOK_EVENT_TYPES = [
  "WorkItem.Created",
  "WorkItem.Updated",
  "WorkItem.StatusChanged",
  "Contact.Updated",
  "Organization.Updated",
  "Note.Created",
  "Note.Updated",
  "Comment.Created",
] as const

export async function POST(request: NextRequest) {
  try {
    const credentials = getKarbonCredentials()
    if (!credentials) {
      return NextResponse.json({ error: "Karbon API credentials not configured" }, { status: 401 })
    }

    const body = await request.json()
    const { eventType = "WorkItem.Updated", targetUrl, secret = process.env.KARBON_WEBHOOK_SECRET } = body

    // Use provided URL or construct from environment
    const webhookUrl =
      targetUrl || `${process.env.NEXT_PUBLIC_APP_URL || process.env.APP_BASE_URL}/api/webhooks/karbon/work-items`

    if (!webhookUrl) {
      return NextResponse.json(
        { error: "Could not determine webhook target URL. Provide targetUrl or set APP_BASE_URL." },
        { status: 400 },
      )
    }

    // Validate event type
    if (!WEBHOOK_EVENT_TYPES.includes(eventType)) {
      return NextResponse.json(
        {
          error: "Invalid event type",
          validTypes: WEBHOOK_EVENT_TYPES,
        },
        { status: 400 },
      )
    }

    // Create webhook subscription in Karbon
    const subscriptionPayload: any = {
      EventType: eventType,
      TargetUrl: webhookUrl,
    }

    // Add signing secret if provided
    if (secret) {
      subscriptionPayload.Secret = secret
    }

    const { data, error } = await karbonFetch<any>("/WebhookSubscriptions", credentials, {
      method: "POST",
      body: subscriptionPayload,
    })

    if (error) {
      console.error("[Karbon Webhook] Failed to create subscription:", error)
      return NextResponse.json({ error: `Failed to create webhook subscription: ${error}` }, { status: 500 })
    }

    console.log("[Karbon Webhook] Created subscription:", data)

    return NextResponse.json({
      success: true,
      subscription: data,
      webhookUrl,
      eventType,
    })
  } catch (error) {
    console.error("[Karbon Webhook] Subscription error:", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 })
  }
}

export async function GET() {
  try {
    const credentials = getKarbonCredentials()
    if (!credentials) {
      return NextResponse.json({ error: "Karbon API credentials not configured" }, { status: 401 })
    }

    const { data, error } = await karbonFetch<any[]>("/WebhookSubscriptions", credentials)

    if (error) {
      return NextResponse.json({ error: `Failed to fetch subscriptions: ${error}` }, { status: 500 })
    }

    return NextResponse.json({
      subscriptions: data || [],
      count: data?.length || 0,
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const credentials = getKarbonCredentials()
    if (!credentials) {
      return NextResponse.json({ error: "Karbon API credentials not configured" }, { status: 401 })
    }

    const { subscriptionKey } = await request.json()

    if (!subscriptionKey) {
      return NextResponse.json({ error: "subscriptionKey is required" }, { status: 400 })
    }

    const { error } = await karbonFetch(`/WebhookSubscriptions/${subscriptionKey}`, credentials, { method: "DELETE" })

    if (error) {
      return NextResponse.json({ error: `Failed to delete subscription: ${error}` }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      deletedKey: subscriptionKey,
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 })
  }
}
