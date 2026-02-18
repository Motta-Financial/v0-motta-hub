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
 * Map Karbon work item data to Supabase work_items table format.
 *
 * This mapper is used by the webhook handler for real-time single-item updates.
 * It mirrors the full mapper in /api/karbon/work-items/route.ts so that
 * webhook-synced rows are identical to cron-synced rows.
 */
export function mapKarbonWorkItemToSupabase(item: any) {
  const feeSettings = item.FeeSettings || {}

  // Parse tax year from YearEnd or title
  let taxYear: number | null = null
  if (item.TaxYear) taxYear = item.TaxYear
  else if (item.YearEnd) {
    const yr = new Date(item.YearEnd).getFullYear()
    if (yr > 2000 && yr < 2100) taxYear = yr
  } else if (item.Title) {
    const m = item.Title.match(/\b(20\d{2})\b/)
    if (m) taxYear = parseInt(m[1], 10)
  }

  return {
    // Core identifiers
    karbon_work_item_key: item.WorkItemKey || item.WorkKey,
    karbon_client_key: item.ClientKey || null,

    // Client information
    client_type: item.ClientType || null,
    client_name: item.ClientName || null,

    // Client owner
    client_owner_key: item.ClientOwnerKey || null,
    client_owner_name: item.ClientOwnerName || null,

    // Client group
    client_group_key: item.RelatedClientGroupKey || item.ClientGroupKey || null,
    client_group_name: item.RelatedClientGroupName || null,

    // Assignee
    assignee_key: item.AssigneeKey || null,
    assignee_name: item.AssigneeName || null,

    // Client manager
    client_manager_key: item.ClientManagerKey || null,
    client_manager_name: item.ClientManagerName || null,

    // Client partner
    client_partner_key: item.ClientPartnerKey || null,
    client_partner_name: item.ClientPartnerName || null,

    // Work item details
    title: item.Title || null,
    description: item.Description || null,
    work_type: item.WorkType || null,

    // Status fields
    workflow_status: item.WorkStatus || null,
    status: item.PrimaryStatus || null,
    status_code: item.SecondaryStatus || null,
    primary_status: item.PrimaryStatus || null,
    secondary_status: item.SecondaryStatus || null,
    work_status_key: item.WorkStatusKey || null,

    // User-defined identifier
    user_defined_identifier: item.UserDefinedIdentifier || null,

    // Dates
    start_date: item.StartDate ? item.StartDate.split("T")[0] : null,
    due_date: item.DueDate ? item.DueDate.split("T")[0] : null,
    completed_date: item.CompletedDate ? item.CompletedDate.split("T")[0] : null,
    year_end: item.YearEnd ? item.YearEnd.split("T")[0] : null,
    tax_year: taxYear,
    period_start: item.PeriodStart ? item.PeriodStart.split("T")[0] : null,
    period_end: item.PeriodEnd ? item.PeriodEnd.split("T")[0] : null,
    internal_due_date: item.InternalDueDate ? item.InternalDueDate.split("T")[0] : null,
    regulatory_deadline: item.RegulatoryDeadline ? item.RegulatoryDeadline.split("T")[0] : null,
    client_deadline: item.ClientDeadline ? item.ClientDeadline.split("T")[0] : null,
    extension_date: item.ExtensionDate ? item.ExtensionDate.split("T")[0] : null,

    // Template
    work_template_key: item.WorkTemplateKey || null,
    work_template_name: item.WorkTemplateTitle || item.WorkTemplateTile || null,

    // Fee settings
    fee_type: feeSettings.FeeType || null,
    estimated_fee: feeSettings.FeeValue || null,
    fixed_fee_amount: feeSettings.FeeType === "Fixed" ? feeSettings.FeeValue : null,
    hourly_rate: feeSettings.FeeType === "Hourly" ? feeSettings.FeeValue : null,

    // Time/budget tracking
    estimated_minutes: item.EstimatedBudgetMinutes || null,
    actual_minutes: item.ActualBudget || null,
    billable_minutes: item.BillableTime || null,
    budget_minutes: item.Budget?.BudgetedHours ? Math.round(item.Budget.BudgetedHours * 60) : null,
    budget_hours: item.Budget?.BudgetedHours || null,
    budget_amount: item.Budget?.BudgetedAmount || null,
    actual_hours: item.ActualHours || null,
    actual_amount: item.ActualAmount || null,
    actual_fee: item.ActualFee || null,

    // Todo tracking
    todo_count: item.TodoCount || 0,
    completed_todo_count: item.CompletedTodoCount || 0,
    has_blocking_todos: item.HasBlockingTodos || false,

    // Metadata
    priority: item.Priority || "Normal",
    tags: item.Tags || [],
    is_recurring: item.IsRecurring ?? false,
    is_billable: item.IsBillable ?? true,
    is_internal: item.IsInternal ?? false,
    notes: item.Notes || null,
    custom_fields: item.CustomFields || {},
    related_work_keys: item.RelatedWorkKeys || [],

    // Karbon URL and sync timestamps
    karbon_url: `https://app2.karbonhq.com/4mTyp9lLRWTC#/work/${item.WorkItemKey || item.WorkKey}`,
    karbon_created_at: item.CreatedDate || item.CreatedDateTime || null,
    karbon_modified_at: item.LastModifiedDateTime || item.ModifiedDate || null,
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
