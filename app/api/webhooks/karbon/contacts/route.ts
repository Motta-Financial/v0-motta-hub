/**
 * Karbon Contact Webhook Handler
 * Receives webhook events from Karbon when contacts are updated.
 * 
 * Karbon WebhookType "Contact" sends events when a contact is modified.
 * The payload contains the ContactKey which we use to fetch the full contact.
 */
import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import {
  verifyKarbonWebhookSignature,
  parseKarbonWebhookPayload,
  logWebhookEvent,
} from "@/lib/karbon-webhook"
import { getKarbonCredentials, karbonFetch } from "@/lib/karbon-api"

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

export async function POST(request: NextRequest) {
  const startTime = Date.now()

  try {
    const body = await request.text()
    const signature = request.headers.get("x-karbon-signature") || request.headers.get("x-webhook-signature")

    logWebhookEvent("Contact", "received", {
      hasSignature: !!signature,
      bodyLength: body.length,
    })

    if (!verifyKarbonWebhookSignature(body, signature)) {
      logWebhookEvent("Contact", "failed", { reason: "Invalid signature" })
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 })
    }

    const payload = parseKarbonWebhookPayload(body)
    if (!payload) {
      logWebhookEvent("Contact", "failed", { reason: "Invalid payload" })
      return NextResponse.json({ error: "Invalid webhook payload" }, { status: 400 })
    }

    const { EventType, Data } = payload
    const contactKey = Data.ContactKey

    if (!contactKey) {
      logWebhookEvent("Contact", "failed", { reason: "Missing ContactKey", eventType: EventType })
      return NextResponse.json({ error: "Missing ContactKey in webhook data" }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()
    if (!supabase) {
      return NextResponse.json({ error: "Database not configured" }, { status: 500 })
    }

    const credentials = getKarbonCredentials()
    if (!credentials) {
      return NextResponse.json({ error: "Karbon API not configured" }, { status: 500 })
    }

    // Fetch the full contact from Karbon API with expanded details
    const { data: contact, error: fetchError } = await karbonFetch<any>(
      `/Contacts(${contactKey})`,
      credentials,
      {
        queryOptions: {
          expand: ["BusinessCards", "AccountingDetail"],
        },
      }
    )

    if (fetchError || !contact) {
      logWebhookEvent("Contact", "failed", {
        reason: "Failed to fetch contact from Karbon",
        error: fetchError,
      })
      return NextResponse.json({ error: "Failed to fetch contact details" }, { status: 500 })
    }

    // Map and upsert the contact
    const primaryCard = contact.BusinessCards?.find((bc: any) => bc.IsPrimaryCard) || contact.BusinessCards?.[0]
    const primaryEmail = primaryCard?.EmailAddresses?.[0] || null
    const primaryPhone = primaryCard?.PhoneNumbers?.[0] || null

    const mappedContact = {
      karbon_contact_key: contact.ContactKey,
      first_name: contact.FirstName || null,
      last_name: contact.LastName || null,
      full_name: `${contact.FirstName || ""} ${contact.LastName || ""}`.trim() || null,
      preferred_name: contact.PreferredName || null,
      email: primaryEmail,
      phone: primaryPhone,
      contact_type: contact.ContactType || null,
      organization_name: primaryCard?.OrganizationName || null,
      karbon_organization_key: primaryCard?.OrganizationKey || null,
      job_title: primaryCard?.RoleOrTitle || null,
      karbon_modified_at: contact.LastModifiedDateTime || new Date().toISOString(),
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const { error: upsertError } = await supabase.from("contacts").upsert(mappedContact, {
      onConflict: "karbon_contact_key",
    })

    if (upsertError) {
      logWebhookEvent("Contact", "failed", {
        reason: "Database upsert failed",
        error: upsertError.message,
      })
      return NextResponse.json({ error: "Failed to sync contact" }, { status: 500 })
    }

    logWebhookEvent("Contact", "processed", {
      eventType: EventType,
      contactKey,
      action: "upserted",
      durationMs: Date.now() - startTime,
    })

    return NextResponse.json({
      success: true,
      eventType: EventType,
      contactKey,
      processedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    })
  } catch (error) {
    logWebhookEvent("Contact", "failed", {
      reason: "Unexpected error",
      error: error instanceof Error ? error.message : "Unknown error",
    })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({
    status: "active",
    webhook: "karbon-contacts",
    timestamp: new Date().toISOString(),
  })
}
