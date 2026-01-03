import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const KARBON_API_BASE = "https://api.karbonhq.com/v3"

// Karbon API headers
function getKarbonHeaders() {
  return {
    Authorization: `Bearer ${process.env.KARBON_BEARER_TOKEN}`,
    AccessKey: process.env.KARBON_ACCESS_KEY || "",
    "Content-Type": "application/json",
  }
}

// Fetch a single organization with expanded BusinessCards
async function fetchOrganizationDetail(entityKey: string) {
  const url = `${KARBON_API_BASE}/Organizations/${entityKey}?$expand=BusinessCards`
  const response = await fetch(url, { headers: getKarbonHeaders() })

  if (!response.ok) {
    console.log(`[v0] Failed to fetch org ${entityKey}: ${response.status}`)
    return null
  }

  return response.json()
}

// Fetch all organizations from Karbon (paginated)
async function fetchAllOrganizations() {
  const allOrgs: any[] = []
  let skip = 0
  const top = 100

  while (true) {
    const url = `${KARBON_API_BASE}/Organizations?$top=${top}&$skip=${skip}`
    const response = await fetch(url, { headers: getKarbonHeaders() })

    if (!response.ok) {
      console.log(`[v0] Failed to fetch organizations page: ${response.status}`)
      break
    }

    const data = await response.json()
    const orgs = data.value || data || []

    if (orgs.length === 0) break

    allOrgs.push(...orgs)
    skip += top

    console.log(`[v0] Fetched ${allOrgs.length} organizations so far...`)

    if (orgs.length < top) break
  }

  return allOrgs
}

// Map Karbon organization to Supabase schema
function mapOrgToSupabase(org: any) {
  // Extract primary business card
  const businessCards = org.BusinessCards || []
  const primaryCard = businessCards.find((bc: any) => bc.IsPrimaryCard) || businessCards[0]

  // Extract email
  let primaryEmail = null
  if (primaryCard?.EmailAddresses?.length > 0) {
    const emails = primaryCard.EmailAddresses
    const primaryEmailObj = emails.find((e: any) => e.IsPrimary) || emails[0]
    primaryEmail = primaryEmailObj?.Address || primaryEmailObj?.Email || primaryEmailObj
    if (typeof primaryEmail === "object") primaryEmail = null
  }

  // Extract phone
  let phone = null
  if (primaryCard?.PhoneNumbers?.length > 0) {
    const phones = primaryCard.PhoneNumbers
    const workPhone = phones.find((p: any) => p.Type === "Work" || p.Type === "Business") || phones[0]
    phone = workPhone?.Number || workPhone?.PhoneNumber || workPhone
    if (typeof phone === "object") phone = null
  }

  // Extract address
  let addressLine1 = null,
    addressLine2 = null,
    city = null,
    state = null,
    zipCode = null,
    country = null
  if (primaryCard?.PostalAddresses?.length > 0) {
    const addr = primaryCard.PostalAddresses[0]
    addressLine1 = addr.AddressLine1 || addr.Street || addr.Line1
    addressLine2 = addr.AddressLine2 || addr.Line2
    city = addr.City || addr.Locality
    state = addr.StateProvince || addr.State || addr.Province || addr.Region
    zipCode = addr.PostCode || addr.PostalCode || addr.ZipCode || addr.Zip
    country = addr.Country || addr.CountryCode
  }

  // Extract website
  let website = null
  if (primaryCard?.WebSites?.length > 0) {
    const site = primaryCard.WebSites[0]
    website = site?.Url || site?.Website || site
    if (typeof website === "object") website = null
  }

  // Extract social media
  let linkedinUrl = null,
    twitterHandle = null,
    facebookUrl = null
  if (primaryCard) {
    linkedinUrl = primaryCard.LinkedInUrl || primaryCard.LinkedInLink || primaryCard.LinkedIn
    twitterHandle = primaryCard.TwitterUrl || primaryCard.TwitterHandle || primaryCard.Twitter
    facebookUrl = primaryCard.FacebookUrl || primaryCard.FacebookLink || primaryCard.Facebook
  }

  return {
    karbon_organization_key: org.OrganizationKey || org.EntityKey,
    name: org.OrganizationName || org.Name || org.LegalName || org.TradingName,
    legal_name: org.LegalName,
    trading_name: org.TradingName,
    description: org.Description,
    entity_type: org.ContactType || org.EntityType || org.Type,
    contact_type: org.ContactType,
    industry: org.Industry,
    line_of_business: org.LineOfBusiness,
    primary_email: primaryEmail,
    phone: phone,
    website: website,
    address_line1: addressLine1,
    address_line2: addressLine2,
    city: city,
    state: state,
    zip_code: zipCode,
    country: country,
    linkedin_url: linkedinUrl,
    twitter_handle: twitterHandle,
    facebook_url: facebookUrl,
    client_manager_key: org.ClientManagerKey,
    client_partner_key: org.ClientPartnerKey,
    parent_organization_key: org.ParentOrganizationKey,
    business_cards: businessCards.length > 0 ? JSON.stringify(businessCards) : null,
    karbon_created_at: org.CreatedDate,
    karbon_modified_at: org.LastModifiedDateTime,
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const limit = Number.parseInt(searchParams.get("limit") || "0")
  const dryRun = searchParams.get("dryRun") === "true"

  try {
    // Initialize Supabase client
    const supabase = createClient(
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "",
    )

    console.log("[v0] Starting Karbon organization migration...")

    // Fetch all organizations from Karbon
    const allOrgs = await fetchAllOrganizations()
    console.log(`[v0] Fetched ${allOrgs.length} organizations from Karbon`)

    // Limit if specified
    const orgsToProcess = limit > 0 ? allOrgs.slice(0, limit) : allOrgs

    const results = {
      total: orgsToProcess.length,
      success: 0,
      failed: 0,
      errors: [] as string[],
      samples: [] as any[],
    }

    // Process each organization
    for (let i = 0; i < orgsToProcess.length; i++) {
      const org = orgsToProcess[i]
      const entityKey = org.OrganizationKey || org.EntityKey

      try {
        // Fetch detailed org data with BusinessCards expanded
        const detailedOrg = await fetchOrganizationDetail(entityKey)

        if (!detailedOrg) {
          results.failed++
          results.errors.push(`Failed to fetch details for ${entityKey}`)
          continue
        }

        // Map to Supabase schema
        const mappedOrg = mapOrgToSupabase(detailedOrg)

        // Store sample for debugging
        if (results.samples.length < 3) {
          results.samples.push({
            karbon: {
              OrganizationKey: detailedOrg.OrganizationKey,
              OrganizationName: detailedOrg.OrganizationName,
              ContactType: detailedOrg.ContactType,
              BusinessCardsCount: detailedOrg.BusinessCards?.length || 0,
            },
            mapped: mappedOrg,
          })
        }

        if (!dryRun) {
          // Upsert to Supabase
          const { error } = await supabase
            .from("organizations")
            .upsert(mappedOrg, { onConflict: "karbon_organization_key" })

          if (error) {
            results.failed++
            results.errors.push(`Failed to upsert ${entityKey}: ${error.message}`)
          } else {
            results.success++
          }
        } else {
          results.success++
        }

        // Progress log every 50 records
        if ((i + 1) % 50 === 0) {
          console.log(`[v0] Processed ${i + 1}/${orgsToProcess.length} organizations...`)
        }

        // Small delay to avoid rate limiting
        if (i % 10 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
      } catch (err: any) {
        results.failed++
        results.errors.push(`Error processing ${entityKey}: ${err.message}`)
      }
    }

    console.log(`[v0] Migration complete: ${results.success} success, ${results.failed} failed`)

    return NextResponse.json({
      message: dryRun ? "Dry run complete" : "Migration complete",
      dryRun,
      results,
    })
  } catch (error: any) {
    console.error("[v0] Migration error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
