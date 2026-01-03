import { type NextRequest, NextResponse } from "next/server"
import { getKarbonCredentials, karbonFetchAll } from "@/lib/karbon-api"
import { createClient } from "@supabase/supabase-js"

function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseKey) {
    return null
  }

  return createClient(supabaseUrl, supabaseKey)
}

function mapKarbonContactToSupabase(contact: any) {
  // Extract business card data (primary card)
  const businessCards = Array.isArray(contact.BusinessCards) ? contact.BusinessCards : []
  const businessCard = businessCards.find((bc: any) => bc.IsPrimaryCard) || businessCards[0] || {}

  // Extract accounting detail
  const accountingDetail = contact.AccountingDetail || {}

  // Extract addresses from business card
  const addresses = businessCard.Addresses
    ? Array.isArray(businessCard.Addresses)
      ? businessCard.Addresses
      : [businessCard.Addresses]
    : []
  const primaryAddress = addresses.find((a: any) => a.Label === "Physical") || addresses[0] || {}
  const mailingAddress = addresses.find((a: any) => a.Label === "Mailing") || {}

  // Extract phone numbers from business card
  const phoneNumbers = businessCard.PhoneNumbers
    ? Array.isArray(businessCard.PhoneNumbers)
      ? businessCard.PhoneNumbers
      : [businessCard.PhoneNumbers]
    : []
  const workPhone = phoneNumbers.find((p: any) => p.Label === "Work")
  const mobilePhone = phoneNumbers.find((p: any) => p.Label === "Mobile")
  const faxPhone = phoneNumbers.find((p: any) => p.Label === "Fax")
  const primaryPhone = phoneNumbers.find((p: any) => p.Label === "Primary") || phoneNumbers[0]

  // Extract email addresses from business card
  const emailAddresses = businessCard.EmailAddresses || []
  const primaryEmail = Array.isArray(emailAddresses) ? emailAddresses[0] : emailAddresses
  const secondaryEmail = Array.isArray(emailAddresses) && emailAddresses.length > 1 ? emailAddresses[1] : null

  // Extract registration numbers - handle both single object and array
  const regNumbers = accountingDetail.RegistrationNumbers || {}
  const regNumbersArray = Array.isArray(regNumbers) ? regNumbers : regNumbers.Type ? [regNumbers] : []

  // Parse registration numbers for specific IDs
  let ein: string | null = null
  let ssnLastFour: string | null = null
  let driversLicense: string | null = null
  let passportNumber: string | null = null

  regNumbersArray.forEach((reg: any) => {
    switch (reg.Type) {
      case "Employer Identification Number (EIN)":
      case "EIN":
        ein = reg.RegistrationNumber
        break
      case "Social Security Number":
      case "SSN":
        // Only store last 4 digits for security
        ssnLastFour = reg.RegistrationNumber?.slice(-4) || null
        break
      case "Driver's License":
        driversLicense = reg.RegistrationNumber
        break
      case "Passport":
        passportNumber = reg.RegistrationNumber
        break
    }
  })

  // Build full name from Karbon name parts
  const nameParts = [contact.Prefix, contact.FirstName, contact.MiddleName, contact.LastName, contact.Suffix].filter(
    Boolean,
  )
  const fullName =
    contact.FullName || nameParts.join(" ") || contact.PreferredName || primaryEmail || `Contact ${contact.ContactKey}`

  return {
    // Core identifiers - Karbon uses ContactKey for individuals
    karbon_contact_key: contact.ContactKey,

    full_name: fullName,

    // Name fields from Karbon Contact
    first_name: contact.FirstName || null,
    last_name: contact.LastName || null,
    middle_name: contact.MiddleName || null,
    preferred_name: contact.PreferredName || null,
    salutation: contact.Salutation || null,
    suffix: contact.Suffix || null,
    prefix: contact.Prefix || null,

    // Contact classification from Karbon
    contact_type: contact.ContactType || "Individual",
    entity_type: accountingDetail.EntityType || "Individual",
    status: contact.Status || "Active",
    restriction_level: contact.RestrictionLevel || null,
    is_prospect: contact.ContactType === "Prospect",

    // Avatar from Karbon
    avatar_url: contact.AvatarUrl || null,

    // Primary email and phone from Karbon Contact or BusinessCard
    primary_email: contact.EmailAddress || primaryEmail || null,
    secondary_email: secondaryEmail || null,
    phone_primary: contact.PhoneNumber || (primaryPhone?.Number ? String(primaryPhone.Number) : null),
    phone_mobile: mobilePhone?.Number ? String(mobilePhone.Number) : null,
    phone_work: workPhone?.Number ? String(workPhone.Number) : null,
    phone_fax: faxPhone?.Number ? String(faxPhone.Number) : null,

    // Physical address from Karbon BusinessCard Addresses
    address_line1: primaryAddress.AddressLines || primaryAddress.Street || null,
    address_line2: primaryAddress.AddressLine2 || null,
    city: primaryAddress.City || null,
    state: primaryAddress.StateProvinceCounty || primaryAddress.State || null,
    zip_code: primaryAddress.ZipCode || primaryAddress.PostalCode || null,
    country: primaryAddress.CountryCode || primaryAddress.Country || null,

    // Mailing address from Karbon BusinessCard Addresses
    mailing_address_line1: mailingAddress.AddressLines || mailingAddress.Street || null,
    mailing_address_line2: mailingAddress.AddressLine2 || null,
    mailing_city: mailingAddress.City || null,
    mailing_state: mailingAddress.StateProvinceCounty || mailingAddress.State || null,
    mailing_zip_code: mailingAddress.ZipCode || mailingAddress.PostalCode || null,
    mailing_country: mailingAddress.CountryCode || mailingAddress.Country || null,

    // Date of birth from Karbon AccountingDetail
    date_of_birth: accountingDetail.BirthDate ? accountingDetail.BirthDate.split("T")[0] : null,

    // Employment from Karbon
    occupation: contact.Occupation || accountingDetail.Occupation || null,
    employer: contact.Employer || null,

    // Source/referral from Karbon
    source: contact.Source || null,
    referred_by: contact.ReferredBy || null,

    // Social links from Karbon BusinessCard
    linkedin_url: businessCard.LinkedInLink || null,
    twitter_handle: businessCard.TwitterLink || null,
    facebook_url: businessCard.FacebookLink || null,
    website: Array.isArray(businessCard.WebSites) ? businessCard.WebSites[0] : businessCard.WebSites || null,

    // Tax/Legal providers from Karbon AccountingDetail
    tax_provider_key: accountingDetail.TaxProvider?.OrganizationKey || null,
    tax_provider_name: accountingDetail.TaxProvider?.Name || null,
    legal_firm_key: accountingDetail.LegalFirm?.OrganizationKey || null,
    legal_firm_name: accountingDetail.LegalFirm?.Name || null,

    // Client manager/partner keys from Karbon
    client_manager_key: contact.ClientManagerKey || null,
    client_partner_key: contact.ClientPartnerKey || null,

    // Registration numbers - parsed from Karbon RegistrationNumbers
    ein: ein,
    ssn_last_four: ssnLastFour,
    drivers_license: driversLicense,
    passport_number: passportNumber,
    registration_numbers: regNumbers,

    // Store full Karbon data as JSONB for reference
    business_cards: businessCards,
    accounting_detail: accountingDetail,
    assigned_team_members: contact.AssignedTeamMembers || [],

    // Tags, notes, custom fields from Karbon
    tags: contact.Tags || [],
    notes: accountingDetail.Notes?.Body || contact.Notes || null,
    custom_fields: contact.CustomFields || {},

    // Contact preference from Karbon
    contact_preference: contact.ContactPreference || null,

    // Karbon URL and sync timestamps
    karbon_url: `https://app2.karbonhq.com/4mTyp9lLRWTC#/contacts/${contact.ContactKey}`,
    karbon_contact_url: `https://app2.karbonhq.com/4mTyp9lLRWTC#/contacts/${contact.ContactKey}`,
    karbon_created_at: contact.CreatedDateTime || null,
    karbon_modified_at: contact.LastModifiedDateTime || null,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

async function fetchExpandedContact(
  contactKey: string,
  credentials: { bearerToken: string; accessKey: string },
): Promise<any | null> {
  try {
    const response = await fetch(
      `https://api.karbonhq.com/v3/Contacts/${contactKey}?$expand=BusinessCards,AccountingDetail`,
      {
        headers: {
          Authorization: `Bearer ${credentials.bearerToken}`,
          AccessKey: credentials.accessKey,
          "Content-Type": "application/json",
        },
      },
    )
    if (!response.ok) {
      console.error(`[v0] Failed to fetch expanded contact ${contactKey}: ${response.status}`)
      return null
    }
    return await response.json()
  } catch (error) {
    console.error(`[v0] Error fetching expanded contact ${contactKey}:`, error)
    return null
  }
}

export async function GET(request: NextRequest) {
  const credentials = getKarbonCredentials()

  if (!credentials) {
    return NextResponse.json(
      {
        error: "Karbon API credentials not configured",
      },
      { status: 401 },
    )
  }

  try {
    const searchParams = request.nextUrl.searchParams
    const debug = searchParams.get("debug") === "true"
    const importToSupabase = searchParams.get("import") === "true"
    const top = searchParams.get("top")
    const incrementalSync = searchParams.get("incremental") === "true"
    const expandDetails = searchParams.get("expand") === "true"

    const queryOptions: any = {}
    if (top) {
      queryOptions.top = Number.parseInt(top, 10)
    }

    // We'll do client-side filtering instead for incremental sync
    let lastSyncTimestamp: string | null = null
    if (incrementalSync && importToSupabase) {
      const supabase = getSupabaseClient()
      if (supabase) {
        const { data: lastSync } = await supabase
          .from("contacts")
          .select("karbon_modified_at")
          .not("karbon_modified_at", "is", null)
          .order("karbon_modified_at", { ascending: false })
          .limit(1)
          .maybeSingle()

        if (lastSync?.karbon_modified_at) {
          lastSyncTimestamp = lastSync.karbon_modified_at
          // Don't add filter to queryOptions - Karbon doesn't support gt operator
        }
      }
    }

    const { data: allContacts, error, totalCount } = await karbonFetchAll<any>("/Contacts", credentials, queryOptions)

    if (error) {
      return NextResponse.json({ error: `Karbon API error: ${error}` }, { status: 500 })
    }

    let contactsToProcess = allContacts
    if (incrementalSync && lastSyncTimestamp) {
      const lastSyncDate = new Date(lastSyncTimestamp)
      contactsToProcess = allContacts.filter((contact: any) => {
        if (!contact.LastModifiedDateTime) return true
        return new Date(contact.LastModifiedDateTime) > lastSyncDate
      })
      console.log(
        `[v0] Incremental sync: filtered ${allContacts.length} contacts to ${contactsToProcess.length} modified since ${lastSyncTimestamp}`,
      )
    }

    if ((expandDetails || importToSupabase) && contactsToProcess.length > 0) {
      const expandedContacts: any[] = []
      const batchSize = 10 // Process 10 at a time to avoid rate limiting

      for (let i = 0; i < contactsToProcess.length; i += batchSize) {
        const batch = contactsToProcess.slice(i, i + batchSize)
        const expandedBatch = await Promise.all(
          batch.map(async (contact: any) => {
            const expanded = await fetchExpandedContact(contact.ContactKey, credentials)
            return expanded || contact // Fall back to original if expand fails
          }),
        )
        expandedContacts.push(...expandedBatch)
      }
      contactsToProcess = expandedContacts
    }

    let importResult = null
    if (importToSupabase) {
      const supabase = getSupabaseClient()
      if (!supabase) {
        importResult = { error: "Supabase not configured" }
      } else {
        let synced = 0
        let errors = 0
        const errorDetails: string[] = []

        const batchSize = 50
        for (let i = 0; i < contactsToProcess.length; i += batchSize) {
          const batch = contactsToProcess.slice(i, i + batchSize)
          const mappedBatch = batch.map((contact: any) => ({
            ...mapKarbonContactToSupabase(contact),
            created_at: new Date().toISOString(),
          }))

          const { error: upsertError } = await supabase.from("contacts").upsert(mappedBatch, {
            onConflict: "karbon_contact_key",
            ignoreDuplicates: false,
          })

          if (upsertError) {
            console.error("[v0] Batch upsert error:", upsertError)
            errors += batch.length
            errorDetails.push(upsertError.message)
          } else {
            synced += batch.length
          }
        }

        importResult = {
          success: errors === 0,
          synced,
          errors,
          incrementalSync,
          lastSyncTimestamp,
          expandedDetails: expandDetails,
          errorDetails: errorDetails.length > 0 ? errorDetails.slice(0, 5) : undefined,
        }
      }
    }

    if (debug) {
      const uniqueContactTypes = [...new Set(contactsToProcess.map((c: any) => c.ContactType).filter(Boolean))]
      const uniqueStatuses = [...new Set(contactsToProcess.map((c: any) => c.Status).filter(Boolean))]
      const uniqueCountries = [...new Set(contactsToProcess.map((c: any) => c.Country).filter(Boolean))]
      const uniqueStates = [...new Set(contactsToProcess.map((c: any) => c.State || c.StateProvince).filter(Boolean))]

      const contactTypeBreakdown: Record<string, number> = {}
      contactsToProcess.forEach((contact: any) => {
        const ct = contact.ContactType || "Unknown"
        contactTypeBreakdown[ct] = (contactTypeBreakdown[ct] || 0) + 1
      })

      const sampleRawItems = contactsToProcess.slice(0, 3).map((contact: any) => ({
        ...contact,
        _availableFields: Object.keys(contact),
      }))

      return NextResponse.json({
        analysis: {
          totalContacts: contactsToProcess.length,
          uniqueContactTypes,
          contactTypeBreakdown,
          uniqueStatuses,
          uniqueCountries,
          uniqueStates: uniqueStates.slice(0, 20),
          sampleRawItems,
          expandedDetails: expandDetails,
        },
        importResult,
        syncInfo: {
          incrementalSync,
          lastSyncTimestamp,
          itemsFetched: contactsToProcess.length,
        },
      })
    }

    return NextResponse.json({
      contacts: contactsToProcess,
      count: contactsToProcess.length,
      totalCount: totalCount || contactsToProcess.length,
      importResult,
    })
  } catch (error) {
    console.error("[v0] Error fetching Karbon contacts:", error)
    return NextResponse.json(
      {
        error: "Failed to fetch contacts from Karbon",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}
