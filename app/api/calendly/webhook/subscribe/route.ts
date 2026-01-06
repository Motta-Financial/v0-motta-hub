import { NextResponse } from "next/server"

const CALENDLY_ACCESS_TOKEN = process.env.CALENDLY_ACCESS_TOKEN
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_BASE_URL

// Create a webhook subscription with Calendly
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { events = ["invitee.created", "invitee.canceled"], scope = "user" } = body

    if (!CALENDLY_ACCESS_TOKEN) {
      return NextResponse.json({ error: "Calendly access token not configured" }, { status: 500 })
    }

    if (!APP_URL) {
      return NextResponse.json({ error: "App URL not configured" }, { status: 500 })
    }

    // First, get the current user to determine the organization/user URI
    const userResponse = await fetch("https://api.calendly.com/users/me", {
      headers: {
        Authorization: `Bearer ${CALENDLY_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    })

    if (!userResponse.ok) {
      const error = await userResponse.text()
      return NextResponse.json({ error: `Failed to get user: ${error}` }, { status: userResponse.status })
    }

    const userData = await userResponse.json()
    const userUri = userData.resource.uri
    const organizationUri = userData.resource.current_organization

    // Create webhook subscription
    const webhookUrl = `${APP_URL}/api/calendly/webhook`

    const subscriptionPayload = {
      url: webhookUrl,
      events: events,
      scope: scope,
      ...(scope === "user" ? { user: userUri } : { organization: organizationUri }),
    }

    const webhookResponse = await fetch("https://api.calendly.com/webhook_subscriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CALENDLY_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(subscriptionPayload),
    })

    if (!webhookResponse.ok) {
      const error = await webhookResponse.text()
      return NextResponse.json({ error: `Failed to create webhook: ${error}` }, { status: webhookResponse.status })
    }

    const webhookData = await webhookResponse.json()

    return NextResponse.json({
      success: true,
      webhook: webhookData.resource,
      webhookUrl,
      message: "Webhook subscription created successfully",
    })
  } catch (error) {
    console.error("Error creating webhook subscription:", error)
    return NextResponse.json({ error: "Failed to create webhook subscription" }, { status: 500 })
  }
}

// List existing webhook subscriptions
export async function GET() {
  try {
    if (!CALENDLY_ACCESS_TOKEN) {
      return NextResponse.json({ error: "Calendly access token not configured" }, { status: 500 })
    }

    // Get the current user first
    const userResponse = await fetch("https://api.calendly.com/users/me", {
      headers: {
        Authorization: `Bearer ${CALENDLY_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    })

    if (!userResponse.ok) {
      const error = await userResponse.text()
      return NextResponse.json({ error: `Failed to get user: ${error}` }, { status: userResponse.status })
    }

    const userData = await userResponse.json()
    const organizationUri = userData.resource.current_organization

    // List webhook subscriptions
    const webhooksResponse = await fetch(
      `https://api.calendly.com/webhook_subscriptions?organization=${encodeURIComponent(organizationUri)}&scope=organization`,
      {
        headers: {
          Authorization: `Bearer ${CALENDLY_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      },
    )

    // Also try user scope
    const userWebhooksResponse = await fetch(
      `https://api.calendly.com/webhook_subscriptions?user=${encodeURIComponent(userData.resource.uri)}&scope=user`,
      {
        headers: {
          Authorization: `Bearer ${CALENDLY_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      },
    )

    const orgWebhooks = webhooksResponse.ok ? (await webhooksResponse.json()).collection : []
    const userWebhooks = userWebhooksResponse.ok ? (await userWebhooksResponse.json()).collection : []

    return NextResponse.json({
      webhooks: [...orgWebhooks, ...userWebhooks],
      user: userData.resource,
    })
  } catch (error) {
    console.error("Error listing webhooks:", error)
    return NextResponse.json({ error: "Failed to list webhooks" }, { status: 500 })
  }
}

// Delete a webhook subscription
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const webhookId = searchParams.get("id")

    if (!webhookId) {
      return NextResponse.json({ error: "Webhook ID required" }, { status: 400 })
    }

    const response = await fetch(`https://api.calendly.com/webhook_subscriptions/${webhookId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${CALENDLY_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    })

    if (!response.ok && response.status !== 204) {
      const error = await response.text()
      return NextResponse.json({ error: `Failed to delete webhook: ${error}` }, { status: response.status })
    }

    return NextResponse.json({ success: true, message: "Webhook deleted" })
  } catch (error) {
    console.error("Error deleting webhook:", error)
    return NextResponse.json({ error: "Failed to delete webhook" }, { status: 500 })
  }
}
