/**
 * Karbon Webhook Utilities
 * Handles webhook signature verification and payload processing
 */
import crypto from "crypto"

export interface KarbonWebhookPayload {
  EventType: string
  EventTime: string
  SubscriptionKey: string
  Data: {
    WorkItemKey?: string
    ContactKey?: string
    OrganizationKey?: string
    NoteKey?: string
    [key: string]: any
  }
}

export type KarbonWebhookEventType =
  | "WorkItem.Created"
  | "WorkItem.Updated"
  | "WorkItem.StatusChanged"
  | "WorkItem.Deleted"
  | "Contact.Updated"
  | "Organization.Updated"
  | "Note.Created"
  | "Note.Updated"
  | "Comment.Created"
  | "User.InviteAccepted"
  | "Invoice.StatusChanged"

/**
 * Verify the HMAC signature of an incoming Karbon webhook
 * Karbon signs webhooks with HMAC-SHA256 if a signing key is configured
 */
export function verifyKarbonWebhookSignature(body: string, signature: string | null, secret?: string): boolean {
  // If no signature provided and no secret configured, allow (for initial setup)
  const webhookSecret = secret || process.env.KARBON_WEBHOOK_SECRET

  if (!webhookSecret) {
    console.warn("[Karbon Webhook] No KARBON_WEBHOOK_SECRET configured, skipping signature verification")
    return true // Allow if no secret is configured (development mode)
  }

  if (!signature) {
    console.error("[Karbon Webhook] Missing signature header")
    return false
  }

  try {
    const hmac = crypto.createHmac("sha256", webhookSecret)
    const digest = hmac.update(body, "utf8").digest("hex")

    // Use timing-safe comparison to prevent timing attacks
    const signatureBuffer = Buffer.from(signature, "hex")
    const digestBuffer = Buffer.from(digest, "hex")

    if (signatureBuffer.length !== digestBuffer.length) {
      return false
    }

    return crypto.timingSafeEqual(signatureBuffer, digestBuffer)
  } catch (error) {
    console.error("[Karbon Webhook] Signature verification error:", error)
    return false
  }
}

/**
 * Parse and validate a Karbon webhook payload
 */
export function parseKarbonWebhookPayload(body: string): KarbonWebhookPayload | null {
  try {
    const payload = JSON.parse(body)

    // Validate required fields
    if (!payload.EventType || !payload.Data) {
      console.error("[Karbon Webhook] Invalid payload structure:", payload)
      return null
    }

    return payload as KarbonWebhookPayload
  } catch (error) {
    console.error("[Karbon Webhook] Failed to parse payload:", error)
    return null
  }
}

/**
 * Map Karbon work item data to Supabase work_items table format
 */
export function mapKarbonWorkItemToSupabase(item: any) {
  return {
    karbon_work_item_key: item.WorkItemKey || item.WorkKey,
    title: item.Title,
    work_type: item.WorkType,
    work_status_key: item.WorkStatus,
    workflow_status: item.WorkStatus,
    status: item.PrimaryStatus || "Unknown",
    status_code: item.SecondaryStatus,
    description: item.Description,

    // Client info
    karbon_client_key: item.ClientKey,
    client_type: item.ClientType,

    // Dates
    start_date: item.StartDate ? new Date(item.StartDate).toISOString() : null,
    due_date: item.DueDate ? new Date(item.DueDate).toISOString() : null,
    completed_date: item.CompletedDate ? new Date(item.CompletedDate).toISOString() : null,

    // Assignment
    assignee_id: null, // Will need to map from Karbon UserKey to our team_members.id

    // Budget/Billing
    estimated_minutes: item.EstimatedBudgetMinutes,
    budget_minutes: item.Budget?.BudgetedHours ? item.Budget.BudgetedHours * 60 : null,
    estimated_fee: item.FeeSettings?.FeeValue,
    is_billable: item.IsBillable ?? true,

    // Metadata
    priority: item.Priority || "Normal",
    tags: item.Tags || [],
    custom_fields: item.CustomFields || {},

    // Karbon URL for linking back
    karbon_url: `https://app.karbonhq.com/work/${item.WorkItemKey || item.WorkKey}`,

    // Sync tracking
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

/**
 * Log webhook processing for debugging and audit
 */
export function logWebhookEvent(
  eventType: string,
  status: "received" | "processed" | "failed",
  details?: Record<string, any>,
) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    eventType,
    status,
    ...details,
  }

  if (status === "failed") {
    console.error("[Karbon Webhook]", JSON.stringify(logEntry))
  } else {
    console.log("[Karbon Webhook]", JSON.stringify(logEntry))
  }
}
