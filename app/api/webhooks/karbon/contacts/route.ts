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

/**
 * Map a Karbon contact to Supabase contacts table format.
 * Mirrors the full mapper in /api/karbon/contacts/route.ts so that
 * webhook-synced rows are identical to cron-synced rows.
 */
function mapKarbonContactForWebhook(contact: any) {
  const businessCards = Array.isArray(contact.BusinessCards) ? contact.BusinessCards : []
  const businessCard = businessCards.find((bc: any) => bc.IsPrimaryCard) || businessCards[0] || {}
  const accountingDetail = contact.AccountingDetail || {}

  // Addresses
  const addresses = Array.isArray(businessCard.Addresses) ? businessCard.Addresses : businessCard.Addresses ? [businessCard.Addresses] : []
  const primaryAddress = addresses.find((a: any) => a.Label === "Physical") || addresses[0] || {}
  const mailingAddress = addresses.find((a: any) => a.Label === "Mailing") || {}

  // Phone numbers
  const phoneNumbers = Array.isArray(businessCard.PhoneNumbers) ? businessCard.PhoneNumbers : businessCard.PhoneNumbers ? [businessCard.PhoneNumbers] : []
  const workPhone = phoneNumbers.find((p: any) => p.Label === "Work")
  const mobilePhone = phoneNumbers.find((p: any) => p.Label === "Mobile")
  const faxPhone = phoneNumbers.find((p: any) => p.Label === "Fax")
  const primaryPhone = phoneNumbers.find((p: any) => p.Label === "Primary") || phoneNumbers[0]

  // Emails
  const emailAddresses = businessCard.EmailAddresses || []
  const primaryEmail = Array.isArray(emailAddresses) ? emailAddresses[0] : emailAddresses
  const secondaryEmail = Array.isArray(emailAddresses) && emailAddresses.length > 1 ? emailAddresses[1] : null

  // Names
  const first_name = contact.FirstName || null
  const last_name = contact.LastName || null
  const full_name = contact.FullName || [first_name, contact.MiddleName, last_name].filter(Boolean).join(" ") || null

  // Registration numbers
  const regNumbers = accountingDetail.RegistrationNumbers || {}
  const regArray = Array.isArray(regNumbers) ? regNumbers : regNumbers.Type ? [regNumbers] : []
  let ein: string | null = null
  let ssnLastFour: string | null = null
  regArray.forEach((reg: any) => {
    if (reg.Type?.includes("EIN") || reg.Type?.includes("Employer")) ein = reg.RegistrationNumber
    if (reg.Type?.includes("SSN") || reg.Type?.includes("Social Security")) ssnLastFour = reg.RegistrationNumber?.slice(-4) || null
  })

  return {
    karbon_contact_key: contact.ContactKey,
    first_name,
    last_name,
    middle_name: contact.MiddleName || null,
    preferred_name: contact.PreferredName || null,
    salutation: contact.Salutation || null,
    suffix: contact.Suffix || null,
    prefix: contact.Prefix || null,
    full_name,
    contact_type: contact.ContactType || "Individual",
    entity_type: accountingDetail.EntityType || "Individual",
    status: contact.Status || "Active",
    restriction_level: contact.RestrictionLevel || null,
    is_prospect: contact.ContactType === "Prospect",
    avatar_url: contact.AvatarUrl || null,
    primary_email: contact.EmailAddress || primaryEmail || null,
    secondary_email: secondaryEmail || null,
    phone_primary: contact.PhoneNumber || (primaryPhone?.Number ? String(primaryPhone.Number) : null),
    phone_mobile: mobilePhone?.Number ? String(mobilePhone.Number) : null,
    phone_work: workPhone?.Number ? String(workPhone.Number) : null,
    phone_fax: faxPhone?.Number ? String(faxPhone.Number) : null,
    address_line1: primaryAddress.AddressLines || primaryAddress.Street || null,
    address_line2: primaryAddress.AddressLine2 || null,
    city: primaryAddress.City || null,
    state: primaryAddress.StateProvinceCounty || primaryAddress.State || null,
    zip_code: primaryAddress.ZipCode || primaryAddress.PostalCode || null,
    country: primaryAddress.CountryCode || primaryAddress.Country || null,
    mailing_address_line1: mailingAddress.AddressLines || mailingAddress.Street || null,
    mailing_address_line2: mailingAddress.AddressLine2 || null,
    mailing_city: mailingAddress.City || null,
    mailing_state: mailingAddress.StateProvinceCounty || mailingAddress.State || null,
    mailing_zip_code: mailingAddress.ZipCode || mailingAddress.PostalCode || null,
    mailing_country: mailingAddress.CountryCode || mailingAddress.Country || null,
    date_of_birth: accountingDetail.BirthDate ? accountingDetail.BirthDate.split("T")[0] : null,
    ein,
    ssn_last_four: ssnLastFour,
    occupation: contact.Occupation || accountingDetail.Occupation || null,
    employer: contact.Employer || null,
    source: contact.Source || null,
    referred_by: contact.ReferredBy || null,
    linkedin_url: businessCard.LinkedInLink || null,
    twitter_handle: businessCard.TwitterLink || null,
    facebook_url: businessCard.FacebookLink || null,
    website: Array.isArray(businessCard.WebSites) ? businessCard.WebSites[0] : businessCard.WebSites || null,
    tax_provider_key: accountingDetail.TaxProvider?.OrganizationKey || null,
    tax_provider_name: accountingDetail.TaxProvider?.Name || null,
    legal_firm_key: accountingDetail.LegalFirm?.OrganizationKey || null,
    legal_firm_name: accountingDetail.LegalFirm?.Name || null,
    client_owner_key: contact.ClientOwnerKey || null,
    client_manager_key: contact.ClientManagerKey || null,
    client_partner_key: contact.ClientPartnerKey || null,
    user_defined_identifier: contact.UserDefinedIdentifier || null,
    registration_numbers: regNumbers,
    business_cards: businessCards,
    accounting_detail: accountingDetail,
    assigned_team_members: contact.AssignedTeamMembers || [],
    tags: contact.Tags || [],
    notes: accountingDetail.Notes?.Body || contact.Notes || null,
    custom_fields: contact.CustomFields || {},
    contact_preference: contact.ContactPreference || null,
    karbon_url: `https://app2.karbonhq.com/4mTyp9lLRWTC#/contacts/${contact.ContactKey}`,
    karbon_contact_url: `https://app2.karbonhq.com/4mTyp9lLRWTC#/contacts/${contact.ContactKey}`,
    karbon_created_at: contact.CreatedDateTime || null,
    karbon_modified_at: contact.LastModifiedDateTime || null,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

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

    // Map using the same comprehensive mapper as the main contacts sync route
    // to ensure webhook-synced rows are identical to cron-synced rows.
    const mappedContact = mapKarbonContactForWebhook(contact)

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
