/**
 * One-time migration script to fetch ALL Organization details from Karbon
 * and update the organizations table in Supabase
 *
 * Run this script to populate organization data from Karbon
 */

const KARBON_API_BASE = "https://api.karbonhq.com/v3"

interface KarbonOrganization {
  OrganizationKey: string
  OrganizationName: string
  LegalName?: string
  TradingName?: string
  Description?: string
  ContactType?: string
  Industry?: string
  LineOfBusiness?: string
  RegistrationNumbers?: Array<{ Type: string; Number: string }> | { Type: string; Number: string }
  BusinessCards?: Array<{
    BusinessCardKey?: string
    IsPrimaryCard?: boolean
    EmailAddresses?: Array<{ Address: string; IsPrimary?: boolean }>
    PhoneNumbers?: Array<{ Type: string; Number: string }>
    PostalAddresses?: Array<{
      AddressLine1?: string
      AddressLine2?: string
      City?: string
      StateProvince?: string
      PostCode?: string
      Country?: string
    }>
    WebSites?: Array<{ Url: string }>
    LinkedInUrl?: string
    TwitterHandle?: string
    FacebookUrl?: string
  }>
  ClientManagerKey?: string
  ClientPartnerKey?: string
  ParentOrganizationKey?: string
  CreatedDate?: string
  LastModifiedDateTime?: string
}

// Map Karbon organization to Supabase format
function mapToSupabase(org: KarbonOrganization) {
  const primaryCard = org.BusinessCards?.find((c) => c.IsPrimaryCard) || org.BusinessCards?.[0]
  const primaryEmail =
    primaryCard?.EmailAddresses?.find((e) => e.IsPrimary)?.Address || primaryCard?.EmailAddresses?.[0]?.Address
  const primaryPhone =
    primaryCard?.PhoneNumbers?.find((p) => p.Type === "Work" || p.Type === "Business")?.Number ||
    primaryCard?.PhoneNumbers?.[0]?.Number
  const primaryAddress = primaryCard?.PostalAddresses?.[0]
  const website = primaryCard?.WebSites?.[0]?.Url

  // Parse registration numbers
  let ein: string | null = null
  let gstNumber: string | null = null
  let taxNumber: string | null = null

  const regNumbers = Array.isArray(org.RegistrationNumbers)
    ? org.RegistrationNumbers
    : org.RegistrationNumbers
      ? [org.RegistrationNumbers]
      : []
  for (const reg of regNumbers) {
    const type = reg.Type?.toLowerCase() || ""
    if (type.includes("ein") || type.includes("employer")) ein = reg.Number
    if (type.includes("gst")) gstNumber = reg.Number
    if (type.includes("tax")) taxNumber = reg.Number
  }

  return {
    karbon_organization_key: org.OrganizationKey,
    name: org.OrganizationName || org.LegalName || org.TradingName || `Organization ${org.OrganizationKey}`,
    legal_name: org.LegalName || null,
    trading_name: org.TradingName || null,
    description: org.Description || null,
    entity_type: org.ContactType || null,
    contact_type: org.ContactType || null,
    industry: org.Industry || null,
    line_of_business: org.LineOfBusiness || null,
    primary_email: primaryEmail || null,
    phone: primaryPhone || null,
    website: website || null,
    address_line1: primaryAddress?.AddressLine1 || null,
    address_line2: primaryAddress?.AddressLine2 || null,
    city: primaryAddress?.City || null,
    state: primaryAddress?.StateProvince || null,
    zip_code: primaryAddress?.PostCode || null,
    country: primaryAddress?.Country || null,
    linkedin_url: primaryCard?.LinkedInUrl || null,
    twitter_handle: primaryCard?.TwitterHandle || null,
    facebook_url: primaryCard?.FacebookUrl || null,
    ein: ein,
    gst_number: gstNumber,
    tax_number: taxNumber,
    client_manager_key: org.ClientManagerKey || null,
    client_partner_key: org.ClientPartnerKey || null,
    parent_organization_key: org.ParentOrganizationKey || null,
    business_cards: org.BusinessCards ? JSON.stringify(org.BusinessCards) : null,
    karbon_created_at: org.CreatedDate || null,
    karbon_modified_at: org.LastModifiedDateTime || null,
    updated_at: new Date().toISOString(),
  }
}

async function fetchFromKarbon(url: string): Promise<any> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.KARBON_BEARER_TOKEN}`,
      AccessKey: process.env.KARBON_ACCESS_KEY || "",
      "Content-Type": "application/json",
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Karbon API error ${response.status}: ${text}`)
  }

  return response.json()
}

async function migrateOrganizations() {
  console.log("Starting Karbon Organizations Migration...")

  // Step 1: Fetch all organizations from Karbon
  let allOrgs: KarbonOrganization[] = []
  let skip = 0
  const top = 100

  while (true) {
    console.log(`Fetching organizations ${skip} to ${skip + top}...`)
    const url = `${KARBON_API_BASE}/Organizations?$top=${top}&$skip=${skip}`
    const data = await fetchFromKarbon(url)

    if (!data.value || data.value.length === 0) break
    allOrgs = allOrgs.concat(data.value)
    skip += top

    if (data.value.length < top) break
  }

  console.log(`Fetched ${allOrgs.length} organizations from Karbon`)

  // Step 2: Fetch expanded details for each organization
  const expandedOrgs: KarbonOrganization[] = []
  let processed = 0

  for (const org of allOrgs) {
    try {
      const url = `${KARBON_API_BASE}/Organizations/${org.OrganizationKey}?$expand=BusinessCards`
      const expanded = await fetchFromKarbon(url)
      expandedOrgs.push(expanded)
      processed++

      if (processed % 50 === 0) {
        console.log(`Expanded ${processed}/${allOrgs.length} organizations...`)
      }

      // Rate limiting - small delay between requests
      await new Promise((resolve) => setTimeout(resolve, 100))
    } catch (error) {
      console.error(`Error fetching org ${org.OrganizationKey}:`, error)
      // Still add the basic org data
      expandedOrgs.push(org)
    }
  }

  console.log(`Expanded ${expandedOrgs.length} organizations with BusinessCards`)

  // Step 3: Map to Supabase format and update
  const mapped = expandedOrgs.map(mapToSupabase)

  console.log("Sample mapped organization:", JSON.stringify(mapped[0], null, 2))

  // Step 4: Update Supabase in batches
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY

  const batchSize = 50
  let updated = 0
  let errors = 0

  for (let i = 0; i < mapped.length; i += batchSize) {
    const batch = mapped.slice(i, i + batchSize)

    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/organizations?on_conflict=karbon_organization_key`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_KEY!,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates",
        },
        body: JSON.stringify(batch),
      })

      if (!response.ok) {
        const text = await response.text()
        console.error(`Supabase batch error: ${text}`)
        errors += batch.length
      } else {
        updated += batch.length
        console.log(`Updated ${updated}/${mapped.length} organizations...`)
      }
    } catch (error) {
      console.error(`Batch update error:`, error)
      errors += batch.length
    }
  }

  console.log(`\nMigration Complete!`)
  console.log(`- Total organizations: ${mapped.length}`)
  console.log(`- Successfully updated: ${updated}`)
  console.log(`- Errors: ${errors}`)

  return { total: mapped.length, updated, errors }
}

// Run the migration
migrateOrganizations()
  .then((result) => console.log("Result:", result))
  .catch((error) => console.error("Migration failed:", error))
