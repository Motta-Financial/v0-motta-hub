/**
 * Karbon Work Items Webhook Handler
 * Receives webhook events from Karbon and syncs work items to Supabase
 *
 * To register this webhook in Karbon:
 * POST https://api.karbonhq.com/v3/WebhookSubscriptions
 * {
 *   "EventType": "WorkItem.Updated",
 *   "TargetUrl": "https://your-domain.com/api/webhooks/karbon/work-items",
 *   "Secret": "your-webhook-secret" // Optional, for signature verification
 * }
 */
import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import {
  verifyKarbonWebhookSignature,
  parseKarbonWebhookPayload,
  mapKarbonWorkItemToSupabase,
  logWebhookEvent,
} from "@/lib/karbon-webhook"
import { getKarbonCredentials, karbonFetch } from "@/lib/karbon-api"

export async function POST(request: NextRequest) {
  const startTime = Date.now()

  try {
    // Get raw body for signature verification
    const body = await request.text()
    const signature = request.headers.get("x-karbon-signature") || request.headers.get("x-webhook-signature")

    logWebhookEvent("WorkItem", "received", {
      hasSignature: !!signature,
      bodyLength: body.length,
    })

    // Verify webhook signature
    if (!verifyKarbonWebhookSignature(body, signature)) {
      logWebhookEvent("WorkItem", "failed", { reason: "Invalid signature" })
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 })
    }

    // Parse the webhook payload
    const payload = parseKarbonWebhookPayload(body)
    if (!payload) {
      logWebhookEvent("WorkItem", "failed", { reason: "Invalid payload" })
      return NextResponse.json({ error: "Invalid webhook payload" }, { status: 400 })
    }

    const { EventType, Data } = payload
    const workItemKey = Data.WorkItemKey

    if (!workItemKey) {
      logWebhookEvent("WorkItem", "failed", {
        reason: "Missing WorkItemKey",
        eventType: EventType,
      })
      return NextResponse.json({ error: "Missing WorkItemKey in webhook data" }, { status: 400 })
    }

    // Initialize Supabase client
    const supabase = await createClient()

    // Handle different event types
    switch (EventType) {
      case "WorkItem.Created":
      case "WorkItem.Updated":
      case "WorkItem.StatusChanged": {
        // Fetch the full work item from Karbon API
        const credentials = getKarbonCredentials()
        if (!credentials) {
          logWebhookEvent("WorkItem", "failed", {
            reason: "Missing Karbon credentials",
          })
          return NextResponse.json({ error: "Karbon API not configured" }, { status: 500 })
        }

        const { data: workItem, error: fetchError } = await karbonFetch<any>(`/WorkItems/${workItemKey}`, credentials, {
          queryOptions: {
            expand: ["UserRoleAssignments", "CustomFields"],
          },
        })

        if (fetchError || !workItem) {
          logWebhookEvent("WorkItem", "failed", {
            reason: "Failed to fetch work item from Karbon",
            error: fetchError,
          })
          return NextResponse.json({ error: "Failed to fetch work item details" }, { status: 500 })
        }

        // Map and upsert the work item
        const mappedItem = mapKarbonWorkItemToSupabase(workItem)

        const { error: upsertError } = await supabase.from("work_items").upsert(mappedItem, {
          onConflict: "karbon_work_item_key",
        })

        if (upsertError) {
          logWebhookEvent("WorkItem", "failed", {
            reason: "Database upsert failed",
            error: upsertError.message,
          })
          return NextResponse.json({ error: "Failed to sync work item to database" }, { status: 500 })
        }

        logWebhookEvent("WorkItem", "processed", {
          eventType: EventType,
          workItemKey,
          action: "upserted",
          durationMs: Date.now() - startTime,
        })

        break
      }

      case "WorkItem.Deleted": {
        // Soft delete or remove the work item
        const { error: deleteError } = await supabase
          .from("work_items")
          .update({
            status: "Deleted",
            updated_at: new Date().toISOString(),
          })
          .eq("karbon_work_item_key", workItemKey)

        if (deleteError) {
          logWebhookEvent("WorkItem", "failed", {
            reason: "Database delete failed",
            error: deleteError.message,
          })
          return NextResponse.json({ error: "Failed to delete work item from database" }, { status: 500 })
        }

        logWebhookEvent("WorkItem", "processed", {
          eventType: EventType,
          workItemKey,
          action: "soft-deleted",
          durationMs: Date.now() - startTime,
        })

        break
      }

      default:
        logWebhookEvent("WorkItem", "processed", {
          eventType: EventType,
          workItemKey,
          action: "ignored",
          reason: "Unhandled event type",
        })
    }

    return NextResponse.json({
      success: true,
      eventType: EventType,
      workItemKey,
      processedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    })
  } catch (error) {
    logWebhookEvent("WorkItem", "failed", {
      reason: "Unexpected error",
      error: error instanceof Error ? error.message : "Unknown error",
    })

    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// Allow GET for webhook URL verification (some systems ping the URL first)
export async function GET() {
  return NextResponse.json({
    status: "active",
    webhook: "karbon-work-items",
    timestamp: new Date().toISOString(),
  })
}
