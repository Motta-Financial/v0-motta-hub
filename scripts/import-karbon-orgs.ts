// Script to fetch all organizations from Karbon API and import into Supabase
// Run this script to populate the organizations table with full data

const KARBON_API_BASE = "https://api.karbonhq.com/v3"

interface KarbonOrganization {
  OrganizationKey?: string
  EntityKey?: string
  OrganizationName?: string
  LegalName?: string
  TradingName?: string
  Description?: string
  ContactType?: string
  Industry?: string
  LineOfBusiness?: string
  RegistrationNumbers?: Array<{ Type?: string; Number?: string }>
  BusinessCards?: Array<{
    BusinessCardKey?: string
    IsPrimaryCard?: boolean
    EmailAddresses?: Array<{ Address?: string; IsPrimary?: boolean }>
    PhoneNumbers?: Array<{ Type?: string; Number?: string }>
    PostalAddresses?: Array<{
      AddressLine1?: string
      AddressLine2?: string
      City?: string
      StateProvince?: string
      PostCode?: string
      Country?: string
    }>
    WebSites?: Array<{ Url?: string }>
    LinkedInUrl?: string
    TwitterHandle?: string
    FacebookUrl?: string
  }>
  AccountingDetail?: {
    EntityType?: string
    FiscalYearEndMonth?: number
    FiscalYearEndDay?: number
    BaseCurrency?: string
    TaxCountryCode?: string
    PaysTax?: boolean
    IsVATRegistered?: boolean
  }
  ClientManagerKey?: string
  ClientPartnerKey?: string
  ParentOrganizationKey?: string
  AssignedTeamMembers?: Array<{ UserKey?: string; Name?: string }>
  CustomFieldValues?: Array<{ FieldName?: string; Value?: string }>
  CreatedDate?: string
  LastModifiedDateTime?: string
}

async function fetchFromKarbon(endpoint: string): Promise<any> {
  const bearerToken = process.env.KARBON_BEARER_TOKEN
  const accessKey = process.env.KARBON_ACCESS_KEY

  if (!bearerToken || !accessKey) {
    throw new Error("Missing KARBON_BEARER_TOKEN or KARBON_ACCESS_KEY environment variables")
  }

  const response = await fetch(`${KARBON_API_BASE}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      AccessKey: accessKey,
      "Content-Type": "application/json",
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Karbon API error: ${response.status} - ${errorText}`)
  }

  return response.json()
}

async function fetchAllOrganizations(): Promise<KarbonOrganization[]> {
  const allOrgs: KarbonOrganization[] = []
  let skip = 0
  const top = 100
  let hasMore = true

  console.log("[v0] Fetching organizations from Karbon...")

  while (hasMore) {
    const data = await fetchFromKarbon(`/Organizations?$top=${top}&$skip=${skip}`)
    const orgs = data.value || data || []

    if (orgs.length === 0) {
      hasMore = false
    } else {
      allOrgs.push(...orgs)
      skip += top
      console.log(`[v0] Fetched ${allOrgs.length} organizations so far...`)
    }
  }

  console.log(`[v0] Total organizations fetched: ${allOrgs.length}`)
  return allOrgs
}

async function fetchOrganizationDetails(orgKey: string): Promise<KarbonOrganization | null> {
  try {
    // Only BusinessCards can be expanded - AccountingDetail is not a navigation property
    const data = await fetchFromKarbon(`/Organizations/${orgKey}?$expand=BusinessCards`)
    return data
  } catch (error) {
    console.error(`[v0] Error fetching details for org ${orgKey}:`, error)
    return null
  }
}

function mapKarbonToSupabase(org: KarbonOrganization): Record<string, any> {
  const orgKey = org.OrganizationKey || org.EntityKey || ""

  // Get primary business card
  const businessCards = org.BusinessCards || []
  const primaryCard = businessCards.find((c) => c.IsPrimaryCard) || businessCards[0]

  // Extract email from primary card
  const emails = primaryCard?.EmailAddresses || []
  const primaryEmail = emails.find((e) => e.IsPrimary)?.Address || emails[0]?.Address || null

  // Extract phone from primary card
  const phones = primaryCard?.PhoneNumbers || []
  const primaryPhone =
    phones.find((p) => p.Type === "Work" || p.Type === "Business")?.Number ||
    phones.find((p) => p.Type === "Mobile")?.Number ||
    phones[0]?.Number ||
    null

  // Extract address from primary card
  const addresses = primaryCard?.PostalAddresses || []
  const primaryAddress = addresses[0]

  // Extract website
  const websites = primaryCard?.WebSites || []
  const website = websites[0]?.Url || null

  // Extract social media links
  const linkedinUrl = primaryCard?.LinkedInUrl || null
  const twitterHandle = primaryCard?.TwitterHandle || null
  const facebookUrl = primaryCard?.FacebookUrl || null

  // Extract registration numbers
  const regNumbers = org.RegistrationNumbers || []
  const findRegNumber = (types: string[]): string | null => {
    for (const type of types) {
      const reg = regNumbers.find((r) => r.Type?.toLowerCase().includes(type.toLowerCase()))
      if (reg?.Number) return reg.Number
    }
    return null
  }

  const ein = findRegNumber(["ein", "employer identification", "federal tax"])
  const gstNumber = findRegNumber(["gst", "goods and services"])
  const businessNumber = findRegNumber(["business number", "abn", "acn"])
  const taxNumber = findRegNumber(["tax", "tin"])
  const salesTaxId = findRegNumber(["sales tax", "sales"])
  const payrollTaxId = findRegNumber(["payroll"])
  const stateTaxId = findRegNumber(["state tax", "state"])

  // Extract accounting detail
  const accounting = org.AccountingDetail || {}

  // Entity type comes from ContactType (Karbon's classification field)
  const entityType = org.ContactType || accounting.EntityType || null

  return {
    karbon_organization_key: orgKey,
    name: org.OrganizationName || org.LegalName || org.TradingName || `Organization ${orgKey}`,
    legal_name: org.LegalName || null,
    trading_name: org.TradingName || null,
    description: org.Description || null,
    entity_type: entityType,
    contact_type: org.ContactType || null,
    industry: org.Industry || null,
    line_of_business: org.LineOfBusiness || null,
    primary_email: primaryEmail,
    phone: primaryPhone,
    website: website,
    address_line1: primaryAddress?.AddressLine1 || null,
    address_line2: primaryAddress?.AddressLine2 || null,
    city: primaryAddress?.City || null,
    state: primaryAddress?.StateProvince || null,
    zip_code: primaryAddress?.PostCode || null,
    country: primaryAddress?.Country || null,
    linkedin_url: linkedinUrl,
    twitter_handle: twitterHandle,
    facebook_url: facebookUrl,
    ein: ein,
    gst_number: gstNumber,
    gst_registered: gstNumber ? true : null,
    business_number: businessNumber,
    tax_number: taxNumber,
    sales_tax_id: salesTaxId,
    payroll_tax_id: payrollTaxId,
    state_tax_id: stateTaxId,
    fiscal_year_end_month: accounting.FiscalYearEndMonth || null,
    fiscal_year_end_day: accounting.FiscalYearEndDay || null,
    base_currency: accounting.BaseCurrency || null,
    tax_country_code: accounting.TaxCountryCode || null,
    pays_tax: accounting.PaysTax ?? null,
    is_vat_registered: accounting.IsVATRegistered ?? null,
    client_manager_key: org.ClientManagerKey || null,
    client_partner_key: org.ClientPartnerKey || null,
    parent_organization_key: org.ParentOrganizationKey || null,
    business_cards: businessCards.length > 0 ? JSON.stringify(businessCards) : null,
    assigned_team_members: org.AssignedTeamMembers ? JSON.stringify(org.AssignedTeamMembers) : null,
    custom_fields: org.CustomFieldValues ? JSON.stringify(org.CustomFieldValues) : null,
    karbon_url: `https://app.karbonhq.com/organization/${orgKey}`,
    karbon_created_at: org.CreatedDate || null,
    karbon_modified_at: org.LastModifiedDateTime || null,
    updated_at: new Date().toISOString(),
  }
}

async function upsertToSupabase(records: Record<string, any>[]): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase environment variables")
  }

  // Process in batches of 50
  const batchSize = 50
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize)

    const response = await fetch(`${supabaseUrl}/rest/v1/organizations`, {
      method: "POST",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(batch),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[v0] Supabase upsert error for batch ${i / batchSize + 1}:`, errorText)
    } else {
      console.log(`[v0] Upserted batch ${i / batchSize + 1} of ${Math.ceil(records.length / batchSize)}`)
    }
  }
}

async function main() {
  console.log("[v0] Starting Karbon Organizations Import...")
  console.log("=".repeat(50))

  try {
    // Step 1: Fetch all organizations (basic data)
    const allOrgs = await fetchAllOrganizations()

    // Step 2: Fetch detailed data for each organization with expanded BusinessCards
    console.log("[v0] Fetching detailed data for each organization...")
    const detailedOrgs: KarbonOrganization[] = []

    for (let i = 0; i < allOrgs.length; i++) {
      const org = allOrgs[i]
      const orgKey = org.OrganizationKey || org.EntityKey

      if (orgKey) {
        const details = await fetchOrganizationDetails(orgKey)
        if (details) {
          detailedOrgs.push(details)
        } else {
          detailedOrgs.push(org) // Fall back to basic data
        }
      }

      // Log progress every 50 organizations
      if ((i + 1) % 50 === 0) {
        console.log(`[v0] Fetched details for ${i + 1}/${allOrgs.length} organizations...`)
      }

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    console.log(`[v0] Total detailed organizations: ${detailedOrgs.length}`)

    // Step 3: Map to Supabase format
    console.log("[v0] Mapping organizations to Supabase format...")
    const mappedRecords = detailedOrgs.map(mapKarbonToSupabase)

    // Log sample data for verification
    console.log("[v0] Sample mapped record:")
    console.log(JSON.stringify(mappedRecords[0], null, 2))

    // Step 4: Upsert to Supabase
    console.log("[v0] Upserting to Supabase...")
    await upsertToSupabase(mappedRecords)

    console.log("=".repeat(50))
    console.log("[v0] Import complete!")
    console.log(`[v0] Total organizations imported: ${mappedRecords.length}`)
  } catch (error) {
    console.error("[v0] Import failed:", error)
    throw error
  }
}

// Run the import
main()
