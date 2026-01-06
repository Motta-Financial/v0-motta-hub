import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import crypto from "crypto"

// Karbon Webhook Event Types
type KarbonWebhookEvent = {
  ResourceType: string
  EventType: string
  ResourcePermaKey: string
  ResourceClientKey?: string
  Timestamp: string
}

// Verify HMAC signature if signing key is configured
function verifySignature(payload: string, signature: string | null, signingKey: string | null): boolean {
  if (!signingKey || !signature) {
    return true // Skip verification if no signing key configured
  }

  const expectedSignature = crypto.createHmac("sha256", signingKey).update(payload).digest("hex")

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
}

// POST - Receive webhook events from Karbon
export async function POST(request: Request) {
  try {
    const payload = await request.text()
    const signature = request.headers.get("X-Karbon-Signature")
    const signingKey = process.env.KARBON_WEBHOOK_SIGNING_KEY || null

    // Verify signature
    if (!verifySignature(payload, signature, signingKey)) {
      console.error("[Karbon Webhook] Invalid signature")
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
    }

    const event: KarbonWebhookEvent = JSON.parse(payload)

    console.log(`[Karbon Webhook] Received: ${event.ResourceType} - ${event.EventType}`)

    const supabase = await createClient()

    // Log the webhook event
    await supabase.from("karbon_webhook_events").insert({
      resource_type: event.ResourceType,
      event_type: event.EventType,
      resource_perma_key: event.ResourcePermaKey,
      resource_client_key: event.ResourceClientKey,
      payload: event,
      received_at: new Date().toISOString(),
    })

    // Process based on resource type
    switch (event.ResourceType) {
      case "Contact":
        await handleContactEvent(event)
        break
      case "Organization":
        await handleOrganizationEvent(event)
        break
      case "WorkItem":
        await handleWorkItemEvent(event)
        break
      case "Invoice":
        await handleInvoiceEvent(event)
        break
      case "ContentItem":
        await handleNoteEvent(event)
        break
      default:
        console.log(`[Karbon Webhook] Unhandled resource type: ${event.ResourceType}`)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[Karbon Webhook] Error:", error)
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 })
  }
}

// Handler functions for different resource types
async function handleContactEvent(event: KarbonWebhookEvent) {
  console.log(`[Karbon Webhook] Processing Contact ${event.EventType}: ${event.ResourcePermaKey}`)

  if (event.EventType === "Deleted") {
    // Mark contact as deleted in Supabase
    const supabase = await createClient()
    await supabase
      .from("contacts")
      .update({ is_active: false, deleted_at: new Date().toISOString() })
      .eq("karbon_contact_key", event.ResourceClientKey || event.ResourcePermaKey)
  } else {
    // Fetch updated contact data from Karbon and sync
    await syncContactFromKarbon(event.ResourceClientKey || event.ResourcePermaKey)
  }
}

async function handleOrganizationEvent(event: KarbonWebhookEvent) {
  console.log(`[Karbon Webhook] Processing Organization ${event.EventType}: ${event.ResourcePermaKey}`)

  if (event.EventType === "Deleted") {
    const supabase = await createClient()
    await supabase
      .from("organizations")
      .update({ is_active: false, deleted_at: new Date().toISOString() })
      .eq("karbon_organization_key", event.ResourceClientKey || event.ResourcePermaKey)
  } else {
    await syncOrganizationFromKarbon(event.ResourceClientKey || event.ResourcePermaKey)
  }
}

async function handleWorkItemEvent(event: KarbonWebhookEvent) {
  console.log(`[Karbon Webhook] Processing WorkItem ${event.EventType}: ${event.ResourcePermaKey}`)
  // Sync work item data
  await syncWorkItemFromKarbon(event.ResourceClientKey || event.ResourcePermaKey)
}

async function handleInvoiceEvent(event: KarbonWebhookEvent) {
  console.log(`[Karbon Webhook] Processing Invoice ${event.EventType}: ${event.ResourcePermaKey}`)
  // Handle invoice events
}

async function handleNoteEvent(event: KarbonWebhookEvent) {
  console.log(`[Karbon Webhook] Processing Note ${event.EventType}: ${event.ResourcePermaKey}`)
  // Handle note/content item events
}

// Sync functions to fetch data from Karbon
async function syncContactFromKarbon(contactKey: string) {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || ""}/api/karbon/clients/${contactKey}`, {
      method: "GET",
    })
    if (response.ok) {
      console.log(`[Karbon Webhook] Contact ${contactKey} synced`)
    }
  } catch (error) {
    console.error(`[Karbon Webhook] Failed to sync contact ${contactKey}:`, error)
  }
}

async function syncOrganizationFromKarbon(orgKey: string) {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || ""}/api/karbon/clients/${orgKey}`, {
      method: "GET",
    })
    if (response.ok) {
      console.log(`[Karbon Webhook] Organization ${orgKey} synced`)
    }
  } catch (error) {
    console.error(`[Karbon Webhook] Failed to sync organization ${orgKey}:`, error)
  }
}

async function syncWorkItemFromKarbon(workItemKey: string) {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || ""}/api/karbon/work-items/${workItemKey}`, {
      method: "GET",
    })
    if (response.ok) {
      console.log(`[Karbon Webhook] WorkItem ${workItemKey} synced`)
    }
  } catch (error) {
    console.error(`[Karbon Webhook] Failed to sync work item ${workItemKey}:`, error)
  }
}
