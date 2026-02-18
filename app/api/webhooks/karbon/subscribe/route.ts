/**
 * Karbon Webhook Subscription Manager
 * Register/unregister webhooks with Karbon API
 *
 * Karbon supports two approaches:
 * 1. POST /v3/WebhookSubscriptions with WebhookType in body
 * 2. POST /v3/WebhookSubscriptions/{Type} endpoints
 *
 * We use approach 1 as it's more consistent.
 */
import { type NextRequest, NextResponse } from "next/server"
import { getKarbonCredentials } from "@/lib/karbon-api"

const BASE_WEBHOOK_ENDPOINT = "/WebhookSubscriptions"

// Endpoint paths for GET/DELETE (type-specific)
const WEBHOOK_ENDPOINTS: Record<string, string> = {
  Work: "/WebhookSubscriptions/Work",
  Contact: "/WebhookSubscriptions/Contact",
  Note: "/WebhookSubscriptions/Note",
}

const WEBHOOK_TYPES = ["Work", "Contact", "Note"] as const
type WebhookType = (typeof WEBHOOK_TYPES)[number]

// Default webhook handler URLs for each type
function getDefaultWebhookUrl(webhookType: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "")

  const handlerPaths: Record<string, string> = {
    Work: "/api/webhooks/karbon/work-items",
    Contact: "/api/webhooks/karbon/contacts",
    Note: "/api/webhooks/karbon/notes",
  }

  return `${baseUrl}${handlerPaths[webhookType] || handlerPaths.Work}`
}

export async function POST(request: NextRequest) {
  try {
    const credentials = getKarbonCredentials()
    if (!credentials) {
      return NextResponse.json({ error: "Karbon API credentials not configured" }, { status: 401 })
    }

    const body = await request.json()
    const { webhookType = "Work", targetUrl, signingKey } = body

    // Use provided URL or default to the correct handler for this webhook type
    const webhookUrl = targetUrl || getDefaultWebhookUrl(webhookType)

    // Ensure URL uses https://
    if (!webhookUrl.startsWith("https://")) {
      return NextResponse.json({ error: "Target URL must begin with https:// (Karbon requirement)" }, { status: 400 })
    }

    // Validate webhook type
    if (!WEBHOOK_TYPES.includes(webhookType as WebhookType)) {
      return NextResponse.json(
        {
          error: "Invalid webhook type",
          validTypes: WEBHOOK_TYPES,
        },
        { status: 400 },
      )
    }

    const subscriptionPayload: Record<string, string> = {
      TargetUrl: webhookUrl,
      WebhookType: webhookType,
    }

    // Add signing key if provided (must be at least 16 alphanumeric chars)
    if (signingKey && signingKey.length >= 16) {
      subscriptionPayload.SigningKey = signingKey
    } else if (process.env.KARBON_WEBHOOK_SECRET && process.env.KARBON_WEBHOOK_SECRET.length >= 16) {
      subscriptionPayload.SigningKey = process.env.KARBON_WEBHOOK_SECRET
    }

    console.log(`[v0] Creating ${webhookType} webhook via base endpoint`)
    console.log(`[v0] Payload:`, JSON.stringify(subscriptionPayload))

    const response = await fetch(`https://api.karbonhq.com/v3${BASE_WEBHOOK_ENDPOINT}`, {
      method: "POST",
      headers: {
        AccessKey: credentials.accessKey,
        Authorization: `Bearer ${credentials.bearerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(subscriptionPayload),
    })

    const responseText = await response.text()
    console.log(`[v0] Karbon response status: ${response.status}`)
    console.log(`[v0] Karbon response body: ${responseText}`)

    if (!response.ok) {
      return NextResponse.json(
        {
          error: `Karbon API error: ${response.status}`,
          details: responseText,
          hint: "Ensure your Karbon API account has webhook permissions enabled.",
        },
        { status: response.status },
      )
    }

    let data = null
    try {
      data = responseText ? JSON.parse(responseText) : {}
    } catch {
      data = { raw: responseText }
    }

    return NextResponse.json({
      success: true,
      subscription: data,
      webhookUrl,
      webhookType,
      note: "Karbon will send ActionType (Created, Updated, etc.) in the webhook payload",
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

    const allSubscriptions: any[] = []

    const results = await Promise.allSettled(
      Object.entries(WEBHOOK_ENDPOINTS).map(async ([type, endpoint]) => {
        return fetchKarbonWebhookSilent(credentials, endpoint, type)
      }),
    )

    for (const result of results) {
      if (result.status === "fulfilled" && result.value.subscriptions) {
        allSubscriptions.push(...result.value.subscriptions)
      }
    }

    return NextResponse.json({
      subscriptions: allSubscriptions,
      count: allSubscriptions.length,
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

    const { webhookType } = await request.json()

    if (!webhookType || !WEBHOOK_TYPES.includes(webhookType as WebhookType)) {
      return NextResponse.json(
        {
          error: "Valid webhookType is required",
          validTypes: WEBHOOK_TYPES,
        },
        { status: 400 },
      )
    }

    const endpoint = WEBHOOK_ENDPOINTS[webhookType]
    console.log(`[v0] Deleting ${webhookType} webhook at endpoint: ${endpoint}`)

    const response = await fetch(`https://api.karbonhq.com/v3${endpoint}`, {
      method: "DELETE",
      headers: {
        AccessKey: credentials.accessKey,
        Authorization: `Bearer ${credentials.bearerToken}`,
        "Content-Type": "application/json",
      },
    })

    const responseText = await response.text()
    console.log(`[v0] Karbon response status: ${response.status}`)
    console.log(`[v0] Karbon response body: ${responseText}`)

    if (!response.ok) {
      return NextResponse.json(
        {
          error: `Karbon API error: ${response.status}`,
          details: responseText,
          hint: "Ensure your Karbon API account has webhook permissions enabled.",
        },
        { status: response.status },
      )
    }

    return NextResponse.json({
      success: true,
      deletedType: webhookType,
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 })
  }
}

async function fetchKarbonWebhook(
  credentials: { accessKey: string; bearerToken: string },
  endpoint: string,
  type: string,
): Promise<{ subscriptions: any[] }> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)

    const response = await fetch(`https://api.karbonhq.com/v3${endpoint}`, {
      headers: {
        AccessKey: credentials.accessKey,
        Authorization: `Bearer ${credentials.bearerToken}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    // Handle 404 as expected "no subscriptions" - don't log as error
    if (response.status === 404) {
      console.log(`[v0] No ${type} webhook subscription exists yet (this is normal)`)
      return { subscriptions: [] }
    }

    if (!response.ok) {
      console.log(`[v0] Unexpected status ${response.status} for ${type} webhooks`)
      return { subscriptions: [] }
    }

    const data = await response.json()
    const subs = data?.value || (Array.isArray(data) ? data : [data])
    const subscriptions: any[] = []

    if (Array.isArray(subs)) {
      subs.forEach((sub: any) => {
        if (sub && sub.TargetUrl) {
          subscriptions.push({ ...sub, WebhookType: type })
        }
      })
    }

    return { subscriptions }
  } catch (err) {
    // Network errors or timeouts - don't propagate
    console.log(`[v0] Could not check ${type} webhooks (network issue)`)
    return { subscriptions: [] }
  }
}

async function fetchKarbonWebhookSilent(
  credentials: { accessKey: string; bearerToken: string },
  endpoint: string,
  type: string,
): Promise<{ subscriptions: any[] }> {
  // Return empty array by default - Karbon 404 means no subscription exists
  const emptyResult = { subscriptions: [] }

  try {
    const response = await fetch(`https://api.karbonhq.com/v3${endpoint}`, {
      method: "GET",
      headers: {
        AccessKey: credentials.accessKey,
        Authorization: `Bearer ${credentials.bearerToken}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    })

    // Any non-2xx response means no subscription or error - return empty
    if (!response.ok) {
      return emptyResult
    }

    const data = await response.json()
    const subs = data?.value || (Array.isArray(data) ? data : [data])
    const subscriptions: any[] = []

    if (Array.isArray(subs)) {
      subs.forEach((sub: any) => {
        if (sub && sub.TargetUrl) {
          subscriptions.push({ ...sub, WebhookType: type })
        }
      })
    }

    return { subscriptions }
  } catch {
    // Any error (network, parse, etc) - return empty
    return emptyResult
  }
}
