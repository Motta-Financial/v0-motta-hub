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

function mapKarbonOrganizationToSupabase(org: any) {
  // ============================================
  // BUSINESS CARDS - from $expand=BusinessCards
  // ============================================
  const businessCards = Array.isArray(org.BusinessCards) ? org.BusinessCards : []
  const primaryCard = businessCards.find((bc: any) => bc.IsPrimaryCard) || businessCards[0] || {}

  // ============================================
  // POSTAL ADDRESSES from BusinessCard
  // ============================================
  const postalAddresses = Array.isArray(primaryCard.PostalAddresses) ? primaryCard.PostalAddresses : []
  const primaryAddress =
    postalAddresses.find((a: any) => a.Type === "Physical" || a.Type === "Business" || a.IsPrimary) ||
    postalAddresses[0] ||
    {}

  // ============================================
  // PHONE NUMBERS from BusinessCard
  // ============================================
  const phoneNumbers = Array.isArray(primaryCard.PhoneNumbers) ? primaryCard.PhoneNumbers : []
  const workPhone = phoneNumbers.find((p: any) => p.Type === "Work" || p.Type === "Business") || phoneNumbers[0]

  // ============================================
  // EMAIL ADDRESSES from BusinessCard
  // ============================================
  const emailAddresses = Array.isArray(primaryCard.EmailAddresses) ? primaryCard.EmailAddresses : []
  const primaryEmailObj = emailAddresses.find((e: any) => e.IsPrimary) || emailAddresses[0]
  const primaryEmail =
    primaryEmailObj?.Address || primaryEmailObj?.Email || (typeof primaryEmailObj === "string" ? primaryEmailObj : null)

  // ============================================
  // WEBSITES from BusinessCard
  // ============================================
  const webSites = Array.isArray(primaryCard.WebSites) ? primaryCard.WebSites : []
  const primaryWebsite = webSites[0]?.Url || webSites[0]

  // ============================================
  // SOCIAL MEDIA from BusinessCard
  // ============================================
  const linkedInUrl = primaryCard.LinkedInUrl || primaryCard.LinkedIn || null
  const twitterHandle = primaryCard.TwitterUrl || primaryCard.Twitter || null
  const facebookUrl = primaryCard.FacebookUrl || primaryCard.Facebook || null

  // ============================================
  // REGISTRATION NUMBERS - check both org level and any nested location
  // ============================================
  const regNumbers = org.RegistrationNumbers || []
  const regNumbersArray = Array.isArray(regNumbers) ? regNumbers : []

  let ein: string | null = null
  let businessNumber: string | null = null
  let taxNumber: string | null = null
  let salesTaxId: string | null = null
  let payrollTaxId: string | null = null
  let unemploymentTaxId: string | null = null
  let stateTaxId: string | null = null
  let gstNumber: string | null = null

  regNumbersArray.forEach((reg: any) => {
    const regNum = reg.RegistrationNumber || reg.Number
    const regType = (reg.Type || "").toLowerCase()

    if (regType.includes("ein") || regType.includes("employer")) {
      ein = regNum
    } else if (regType.includes("business number") || regType.includes("abn")) {
      businessNumber = regNum
    } else if (
      regType.includes("tax") &&
      !regType.includes("sales") &&
      !regType.includes("payroll") &&
      !regType.includes("state")
    ) {
      taxNumber = regNum
    } else if (regType.includes("sales tax")) {
      salesTaxId = regNum
    } else if (regType.includes("payroll")) {
      payrollTaxId = regNum
    } else if (regType.includes("unemployment") || regType.includes("suta")) {
      unemploymentTaxId = regNum
    } else if (regType.includes("state")) {
      stateTaxId = regNum
    } else if (regType.includes("gst")) {
      gstNumber = regNum
    }
  })

  // ContactType is Karbon's classification field (Client, Prospect, Supplier, etc.)
  const entityType = org.ContactType || org.EntityType || null

  // ============================================
  // FINAL MAPPING
  // ============================================
  return {
    karbon_organization_key: org.OrganizationKey,
    name: org.OrganizationName || org.Name || `Organization ${org.OrganizationKey}`,
    legal_name: org.LegalName || null,
    trading_name: org.TradingName || null,
    description: org.Description || null,

    entity_type: entityType,
    contact_type: org.ContactType || null,

    industry: org.Industry || null,
    line_of_business: org.LineOfBusiness || null,
    primary_email: typeof primaryEmail === "string" ? primaryEmail : null,
    phone: workPhone?.Number || null,
    website: typeof primaryWebsite === "string" ? primaryWebsite : null,
    address_line1: primaryAddress.AddressLine1 || primaryAddress.Street || null,
    address_line2: primaryAddress.AddressLine2 || null,
    city: primaryAddress.City || null,
    state: primaryAddress.StateProvince || primaryAddress.State || null,
    zip_code: primaryAddress.PostCode || primaryAddress.PostalCode || primaryAddress.ZipCode || null,
    country: primaryAddress.Country || null,
    linkedin_url: linkedInUrl,
    twitter_handle: twitterHandle,
    facebook_url: facebookUrl,
    incorporation_state: org.IncorporationState || null,
    incorporation_date: org.IncorporationDate ? org.IncorporationDate.split("T")[0] : null,
    fiscal_year_end_month: org.FinancialYearEndMonth || null,
    fiscal_year_end_day: org.FinancialYearEndDay || null,
    annual_revenue: org.AnnualRevenue || null,
    base_currency: org.BaseCurrency || "USD",
    valuation: org.OrganizationValuation || null,
    valuation_date: org.ValuationDate ? org.ValuationDate.split("T")[0] : null,
    number_of_employees: org.NumberOfEmployees || null,
    tax_country_code: org.TaxCountryCode || null,
    is_vat_registered: org.IsVATRegistered ?? false,
    pays_tax: org.PaysTax ?? true,
    gst_registered: org.PrepareGST ?? false,
    gst_number: gstNumber || org.GSTNumber || null,
    gst_filing_frequency: org.GstPeriod || null,
    gst_reporting_method: org.GstBasis || null,
    ein: ein,
    business_number: businessNumber,
    tax_number: taxNumber,
    sales_tax_id: salesTaxId,
    payroll_tax_id: payrollTaxId,
    unemployment_tax_id: unemploymentTaxId,
    state_tax_id: stateTaxId,
    tax_provider_key: org.TaxProvider?.OrganizationKey || null,
    tax_provider_name: org.TaxProvider?.Name || null,
    legal_firm_key: org.LegalFirm?.OrganizationKey || null,
    legal_firm_name: org.LegalFirm?.Name || null,
    client_manager_key: org.ClientManagerKey || null,
    client_partner_key: org.ClientPartnerKey || null,
    parent_organization_key: org.ParentOrganizationKey || null,
    source: org.Source || null,
    referred_by: org.ReferredBy || null,
    business_cards: businessCards.length > 0 ? businessCards : null,
    accounting_detail: null, // AccountingDetail cannot be expanded via API
    assigned_team_members: org.AssignedTeamMembers || null,
    shareholders: org.Shareholders || null,
    directors: org.Directors || null,
    officers: org.Officers || null,
    subsidiaries: org.Subsidiaries || null,
    notes: org.Notes?.Body || null,
    custom_fields: org.CustomFieldValues || null,
    karbon_url: `https://app2.karbonhq.com/4mTyp9lLRWTC#/organizations/${org.OrganizationKey}`,
    karbon_created_at: org.CreatedDateTime || null,
    karbon_modified_at: org.LastModifiedDateTime || null,
    updated_at: new Date().toISOString(),
  }
}

async function fetchExpandedOrganization(
  organizationKey: string,
  credentials: { bearerToken: string; accessKey: string },
): Promise<any | null> {
  try {
    const response = await fetch(`https://api.karbonhq.com/v3/Organizations/${organizationKey}?$expand=BusinessCards`, {
      headers: {
        Authorization: `Bearer ${credentials.bearerToken}`,
        AccessKey: credentials.accessKey,
        "Content-Type": "application/json",
      },
    })

    if (!response.ok) {
      const errorBody = await response.text()
      console.error(`[v0] Failed to fetch org ${organizationKey}: ${response.status} - ${errorBody}`)
      return null
    }

    const data = await response.json()
    console.log(
      `[v0] Expanded org ${organizationKey} - has BusinessCards:`,
      Array.isArray(data.BusinessCards) && data.BusinessCards.length > 0,
    )

    return data
  } catch (error) {
    console.error(`[v0] Error fetching org ${organizationKey}:`, error)
    return null
  }
}

export async function GET(request: NextRequest) {
  const credentials = getKarbonCredentials()

  if (!credentials) {
    return NextResponse.json({ error: "Karbon API credentials not configured" }, { status: 401 })
  }

  try {
    const searchParams = request.nextUrl.searchParams
    const debug = searchParams.get("debug") === "true"
    const importToSupabase = searchParams.get("import") === "true"
    const top = searchParams.get("top")
    const incrementalSync = searchParams.get("incremental") === "true"
    const expandDetails = searchParams.get("expand") === "true" || importToSupabase

    const queryOptions: any = {}
    if (top) {
      queryOptions.top = Number.parseInt(top, 10)
    }

    let lastSyncTimestamp: string | null = null
    if (incrementalSync && importToSupabase) {
      const supabase = getSupabaseClient()
      if (supabase) {
        const { data: lastSync } = await supabase
          .from("organizations")
          .select("karbon_modified_at")
          .not("karbon_modified_at", "is", null)
          .order("karbon_modified_at", { ascending: false })
          .limit(1)
          .maybeSingle()

        if (lastSync?.karbon_modified_at) {
          lastSyncTimestamp = lastSync.karbon_modified_at
        }
      }
    }

    // First fetch the list of organizations (without expanded data)
    const {
      data: allOrganizations,
      error,
      totalCount,
    } = await karbonFetchAll<any>("/Organizations", credentials, queryOptions)

    if (error) {
      return NextResponse.json({ error: `Karbon API error: ${error}` }, { status: 500 })
    }

    let organizationsToProcess = allOrganizations

    // Filter for incremental sync if applicable
    if (incrementalSync && lastSyncTimestamp) {
      const lastSyncDate = new Date(lastSyncTimestamp)
      organizationsToProcess = allOrganizations.filter((org: any) => {
        if (!org.LastModifiedDateTime) return true
        return new Date(org.LastModifiedDateTime) > lastSyncDate
      })
      console.log(
        `[v0] Incremental sync: ${organizationsToProcess.length} of ${allOrganizations.length} orgs modified since ${lastSyncTimestamp}`,
      )
    }

    if (expandDetails && organizationsToProcess.length > 0) {
      console.log(`[v0] Fetching expanded details for ${organizationsToProcess.length} organizations...`)
      const expandedOrganizations: any[] = []
      const batchSize = 10

      for (let i = 0; i < organizationsToProcess.length; i += batchSize) {
        const batch = organizationsToProcess.slice(i, i + batchSize)
        console.log(
          `[v0] Processing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(organizationsToProcess.length / batchSize)}`,
        )

        const expandedBatch = await Promise.all(
          batch.map(async (org: any) => {
            const expanded = await fetchExpandedOrganization(org.OrganizationKey, credentials)
            return expanded || org
          }),
        )
        expandedOrganizations.push(...expandedBatch)

        // Small delay to avoid rate limiting
        if (i + batchSize < organizationsToProcess.length) {
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
      }
      organizationsToProcess = expandedOrganizations
    }

    const entityTypes: Record<string, number> = {}
    const industries: Record<string, number> = {}
    const countries: Set<string> = new Set()
    const states: Set<string> = new Set()

    organizationsToProcess.forEach((org: any) => {
      // Entity type from ContactType
      const et = org.ContactType || "Unknown"
      entityTypes[et] = (entityTypes[et] || 0) + 1

      // Industry
      const ind = org.Industry || "Unknown"
      industries[ind] = (industries[ind] || 0) + 1

      // Get address from BusinessCard if available
      const businessCards = Array.isArray(org.BusinessCards) ? org.BusinessCards : []
      const primaryCard = businessCards.find((bc: any) => bc.IsPrimaryCard) || businessCards[0] || {}
      const postalAddresses = Array.isArray(primaryCard.PostalAddresses) ? primaryCard.PostalAddresses : []
      const primaryAddress = postalAddresses[0] || {}

      const country = primaryAddress.Country || org.Country
      const state = primaryAddress.StateProvince || primaryAddress.State || org.State

      if (country) countries.add(country)
      if (state) states.add(state)
    })

    const analysis = {
      totalOrganizations: organizationsToProcess.length,
      uniqueEntityTypes: Object.keys(entityTypes),
      entityTypeBreakdown: entityTypes,
      uniqueIndustries: Object.keys(industries),
      industryBreakdown: industries,
      uniqueCountries: Array.from(countries),
      uniqueStates: Array.from(states),
      sampleRawItems: organizationsToProcess.slice(0, 3),
    }

    // Debug mode - show additional field information
    if (debug) {
      const sampleOrgs = organizationsToProcess.slice(0, 3)

      return NextResponse.json({
        analysis,
        debug: {
          sampleOrganizations: sampleOrgs.map((org: any) => ({
            OrganizationKey: org.OrganizationKey,
            OrganizationName: org.OrganizationName,
            topLevelKeys: Object.keys(org),
            BusinessCards: org.BusinessCards
              ? {
                  count: org.BusinessCards.length,
                  primaryCardKeys: org.BusinessCards[0] ? Object.keys(org.BusinessCards[0]) : [],
                }
              : null,
          })),
        },
        expandedDetails: expandDetails,
      })
    }

    // Import to Supabase
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
        for (let i = 0; i < organizationsToProcess.length; i += batchSize) {
          const batch = organizationsToProcess.slice(i, i + batchSize)
          const mappedBatch = batch.map((org: any) => ({
            ...mapKarbonOrganizationToSupabase(org),
            created_at: new Date().toISOString(),
          }))

          const { error: upsertError } = await supabase.from("organizations").upsert(mappedBatch, {
            onConflict: "karbon_organization_key",
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

    return NextResponse.json({
      organizations: organizationsToProcess,
      analysis,
      count: organizationsToProcess.length,
      totalCount: totalCount || organizationsToProcess.length,
      importResult,
    })
  } catch (error) {
    console.error("[v0] Error fetching Karbon organizations:", error)
    return NextResponse.json(
      {
        error: "Failed to fetch organizations from Karbon",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}
