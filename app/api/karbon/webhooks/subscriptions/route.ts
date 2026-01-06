import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

const KARBON_API_BASE = "https://api.karbonhq.com/v3"

// Webhook subscription endpoints by type
const WEBHOOK_ENDPOINTS: Record<string, string> = {
  Contact: "/WebhookSubscriptions",
  Organization: "/WebhookSubscriptions",
  Invoice: "/WebhookSubscriptions",
  WorkItem: "/WebhookSubscriptions/Work",
  ContentItem: "/WebhookSubscriptions/ContentItem",
}

async function getKarbonHeaders() {
  return {
    Authorization: `Bearer ${process.env.KARBON_BEARER_TOKEN}`,
    AccessKey: process.env.KARBON_ACCESS_KEY || "",
    "Content-Type": "application/json",
  }
}

// GET - List all webhook subscriptions
export async function GET() {
  try {
    const headers = await getKarbonHeaders()
    const subscriptions: any[] = []

    // Fetch subscriptions from each endpoint
    for (const [type, endpoint] of Object.entries(WEBHOOK_ENDPOINTS)) {
      try {
        const response = await fetch(`${KARBON_API_BASE}${endpoint}`, {
          headers,
        })

        if (response.ok) {
          const data = await response.json()
          const items = data.value || data || []
          items.forEach((sub: any) => {
            subscriptions.push({ ...sub, subscriptionType: type })
          })
        }
      } catch (error) {
        console.error(`[Karbon Webhooks] Failed to fetch ${type} subscriptions:`, error)
      }
    }

    return NextResponse.json({ subscriptions })
  } catch (error) {
    console.error("[Karbon Webhooks] Error fetching subscriptions:", error)
    return NextResponse.json({ error: "Failed to fetch subscriptions" }, { status: 500 })
  }
}

// POST - Create a new webhook subscription
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { webhookType, targetUrl, signingKey } = body

    // Validate required fields
    if (!webhookType || !targetUrl) {
      return NextResponse.json({ error: "webhookType and targetUrl are required" }, { status: 400 })
    }

    // Ensure HTTPS
    if (!targetUrl.startsWith("https://")) {
      return NextResponse.json({ error: "targetUrl must use https://" }, { status: 400 })
    }

    const endpoint = WEBHOOK_ENDPOINTS[webhookType]
    if (!endpoint) {
      return NextResponse.json(
        { error: `Invalid webhookType: ${webhookType}. Valid types: ${Object.keys(WEBHOOK_ENDPOINTS).join(", ")}` },
        { status: 400 },
      )
    }

    const headers = await getKarbonHeaders()

    // Build subscription payload
    const subscriptionPayload: any = {
      TargetUrl: targetUrl,
    }

    // Add WebhookType for Invoice subscriptions
    if (webhookType === "Invoice") {
      subscriptionPayload.WebhookType = "Invoice"
    }

    // Add signing key if provided
    if (signingKey) {
      subscriptionPayload.SigningKey = signingKey
    }

    console.log(`[Karbon Webhooks] Creating ${webhookType} subscription to ${targetUrl}`)

    const response = await fetch(`${KARBON_API_BASE}${endpoint}`, {
      method: "POST",
      headers,
      body: JSON.stringify(subscriptionPayload),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[Karbon Webhooks] Failed to create subscription:`, errorText)
      return NextResponse.json({ error: `Failed to create subscription: ${errorText}` }, { status: response.status })
    }

    const subscription = await response.json()

    // Store subscription in Supabase for tracking
    const supabase = await createClient()
    await supabase.from("karbon_webhook_subscriptions").insert({
      karbon_subscription_id: subscription.WebhookSubscriptionPermaKey || subscription.PermaKey,
      webhook_type: webhookType,
      target_url: targetUrl,
      signing_key_configured: !!signingKey,
      created_at: new Date().toISOString(),
    })

    return NextResponse.json({
      success: true,
      subscription,
      message: `${webhookType} webhook subscription created successfully`,
    })
  } catch (error) {
    console.error("[Karbon Webhooks] Error creating subscription:", error)
    return NextResponse.json({ error: "Failed to create subscription" }, { status: 500 })
  }
}

// DELETE - Remove a webhook subscription
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const subscriptionId = searchParams.get("subscriptionId")
    const webhookType = searchParams.get("webhookType") || "Contact"

    if (!subscriptionId) {
      return NextResponse.json({ error: "subscriptionId is required" }, { status: 400 })
    }

    const endpoint = WEBHOOK_ENDPOINTS[webhookType] || "/WebhookSubscriptions"
    const headers = await getKarbonHeaders()

    const response = await fetch(`${KARBON_API_BASE}${endpoint}/${subscriptionId}`, {
      method: "DELETE",
      headers,
    })

    if (!response.ok && response.status !== 204) {
      const errorText = await response.text()
      return NextResponse.json({ error: `Failed to delete subscription: ${errorText}` }, { status: response.status })
    }

    // Remove from Supabase tracking
    const supabase = await createClient()
    await supabase.from("karbon_webhook_subscriptions").delete().eq("karbon_subscription_id", subscriptionId)

    return NextResponse.json({
      success: true,
      message: "Webhook subscription deleted successfully",
    })
  } catch (error) {
    console.error("[Karbon Webhooks] Error deleting subscription:", error)
    return NextResponse.json({ error: "Failed to delete subscription" }, { status: 500 })
  }
}
