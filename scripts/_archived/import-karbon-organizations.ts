import { createClient } from "@supabase/supabase-js"

const KARBON_API_BASE = "https://api.karbonhq.com/v3"
const KARBON_BEARER_TOKEN = process.env.KARBON_BEARER_TOKEN
const KARBON_ACCESS_KEY = process.env.KARBON_ACCESS_KEY

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

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
  RegistrationNumbers?: Array<{ Type?: string; Value?: string }> | { Type?: string; Value?: string }
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
    SocialMediaLinks?: {
      LinkedInUrl?: string
      TwitterUrl?: string
      FacebookUrl?: string
    }
  }>
  ClientManagerKey?: string
  ClientPartnerKey?: string
  ParentOrganizationKey?: string
  CreatedDate?: string
  LastModifiedDateTime?: string
  CustomFieldValues?: Array<{ FieldName?: string; Value?: string }>
}

async function karbonFetch(endpoint: string): Promise<any> {
  const response = await fetch(`${KARBON_API_BASE}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${KARBON_BEARER_TOKEN}`,
      AccessKey: KARBON_ACCESS_KEY || "",
      "Content-Type": "application/json",
    },
  })

  if (!response.ok) {
    const text = await response.text()
    console.log(`[v0] Karbon API error for ${endpoint}: ${response.status} - ${text}`)
    return null
  }

  return response.json()
}

async function fetchAllOrganizations(): Promise<KarbonOrganization[]> {
  const allOrgs: KarbonOrganization[] = []
  let skip = 0
  const top = 100

  console.log("[v0] Fetching organizations from Karbon...")

  while (true) {
    const data = await karbonFetch(`/Organizations?$top=${top}&$skip=${skip}`)
    if (!data || !data.value || data.value.length === 0) break

    allOrgs.push(...data.value)
    console.log(`[v0] Fetched ${allOrgs.length} organizations so far...`)

    if (data.value.length < top) break
    skip += top
  }

  console.log(`[v0] Total organizations fetched: ${allOrgs.length}`)
  return allOrgs
}

async function fetchOrganizationDetails(entityKey: string): Promise<KarbonOrganization | null> {
  const data = await karbonFetch(`/Organizations/${entityKey}?$expand=BusinessCards`)
  return data
}

function parseRegistrationNumbers(regNumbers: any): Record<string, string | null> {
  const result: Record<string, string | null> = {
    ein: null,
    business_number: null,
    tax_number: null,
    gst_number: null,
    sales_tax_id: null,
    payroll_tax_id: null,
    unemployment_tax_id: null,
    state_tax_id: null,
  }

  if (!regNumbers) return result

  const numbers = Array.isArray(regNumbers) ? regNumbers : [regNumbers]

  for (const reg of numbers) {
    const type = (reg.Type || "").toLowerCase()
    const value = reg.Value || null

    if (type.includes("ein") || type.includes("employer")) {
      result.ein = value
    } else if (type.includes("business")) {
      result.business_number = value
    } else if (type.includes("gst")) {
      result.gst_number = value
    } else if (type.includes("sales")) {
      result.sales_tax_id = value
    } else if (type.includes("payroll")) {
      result.payroll_tax_id = value
    } else if (type.includes("unemployment")) {
      result.unemployment_tax_id = value
    } else if (type.includes("state")) {
      result.state_tax_id = value
    } else if (type.includes("tax")) {
      result.tax_number = value
    }
  }

  return result
}

function mapOrganizationToSupabase(org: KarbonOrganization): Record<string, any> {
  const primaryCard = org.BusinessCards?.find((c) => c.IsPrimaryCard) || org.BusinessCards?.[0]
  const regNumbers = parseRegistrationNumbers(org.RegistrationNumbers)

  // Extract contact info from business card
  const primaryEmail =
    primaryCard?.EmailAddresses?.find((e) => e.IsPrimary)?.Address || primaryCard?.EmailAddresses?.[0]?.Address
  const primaryPhone =
    primaryCard?.PhoneNumbers?.find(
      (p) => p.Type?.toLowerCase().includes("work") || p.Type?.toLowerCase().includes("business"),
    )?.Number || primaryCard?.PhoneNumbers?.[0]?.Number
  const primaryAddress = primaryCard?.PostalAddresses?.[0]
  const website = primaryCard?.WebSites?.[0]?.Url

  // Social media
  const socialLinks = primaryCard?.SocialMediaLinks || {}
  const linkedinUrl = socialLinks.LinkedInUrl || null
  const twitterHandle = socialLinks.TwitterUrl || null
  const facebookUrl = socialLinks.FacebookUrl || null

  return {
    karbon_organization_key: org.OrganizationKey || org.EntityKey,
    name:
      org.OrganizationName ||
      org.LegalName ||
      org.TradingName ||
      `Organization ${org.OrganizationKey || org.EntityKey}`,
    legal_name: org.LegalName || null,
    trading_name: org.TradingName || null,
    description: org.Description || null,
    entity_type: org.ContactType || null, // ContactType is Karbon's entity classification
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
    linkedin_url: linkedinUrl,
    twitter_handle: twitterHandle,
    facebook_url: facebookUrl,
    client_manager_key: org.ClientManagerKey || null,
    client_partner_key: org.ClientPartnerKey || null,
    parent_organization_key: org.ParentOrganizationKey || null,
    business_cards: org.BusinessCards || [],
    custom_fields: org.CustomFieldValues || null,
    karbon_url: org.OrganizationKey ? `https://app.karbonhq.com/organizations/${org.OrganizationKey}` : null,
    karbon_created_at: org.CreatedDate || null,
    karbon_modified_at: org.LastModifiedDateTime || null,
    ...regNumbers,
    updated_at: new Date().toISOString(),
  }
}

async function importOrganizations() {
  console.log("[v0] Starting Karbon Organizations import...")
  console.log("[v0] Supabase URL:", supabaseUrl)

  // First, fetch the list of all organizations
  const orgList = await fetchAllOrganizations()

  if (orgList.length === 0) {
    console.log("[v0] No organizations found in Karbon")
    return
  }

  // Process in batches
  const batchSize = 50
  let processed = 0
  let updated = 0
  let errors = 0

  for (let i = 0; i < orgList.length; i += batchSize) {
    const batch = orgList.slice(i, i + batchSize)
    const mappedOrgs: Record<string, any>[] = []

    // Fetch detailed info for each org in batch
    for (const org of batch) {
      const entityKey = org.OrganizationKey || org.EntityKey
      if (!entityKey) continue

      try {
        // Fetch with expanded BusinessCards
        const detailedOrg = await fetchOrganizationDetails(entityKey)
        if (detailedOrg) {
          const mapped = mapOrganizationToSupabase(detailedOrg)
          mappedOrgs.push(mapped)
          console.log(`[v0] Mapped: ${mapped.name} (${mapped.entity_type || "no type"})`)
        } else {
          // Fallback to basic info
          const mapped = mapOrganizationToSupabase(org)
          mappedOrgs.push(mapped)
        }
      } catch (err) {
        console.log(`[v0] Error fetching details for ${entityKey}:`, err)
        errors++
      }

      processed++
    }

    // Upsert batch to Supabase
    if (mappedOrgs.length > 0) {
      const { error } = await supabase.from("organizations").upsert(mappedOrgs, {
        onConflict: "karbon_organization_key",
      })

      if (error) {
        console.log(`[v0] Supabase upsert error:`, error.message)
        errors += mappedOrgs.length
      } else {
        updated += mappedOrgs.length
        console.log(`[v0] Upserted ${mappedOrgs.length} organizations`)
      }
    }

    console.log(`[v0] Progress: ${processed}/${orgList.length} (${updated} updated, ${errors} errors)`)

    // Small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  console.log(`[v0] Import complete! Processed: ${processed}, Updated: ${updated}, Errors: ${errors}`)
}

// Run the import
importOrganizations()
  .then(() => {
    console.log("[v0] Script finished")
    process.exit(0)
  })
  .catch((err) => {
    console.error("[v0] Script error:", err)
    process.exit(1)
  })
