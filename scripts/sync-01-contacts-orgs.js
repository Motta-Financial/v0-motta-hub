import fetch from "node-fetch"

const KARBON_BASE = "https://api.karbonhq.com/v3"
const KARBON_HEADERS = {
  "Authorization": "Bearer " + process.env.KARBON_BEARER_TOKEN,
  "AccessKey": process.env.KARBON_ACCESS_KEY,
  "Accept": "application/json",
}
const SB_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SB_URL || !SB_KEY || !process.env.KARBON_BEARER_TOKEN || !process.env.KARBON_ACCESS_KEY) {
  console.error("Missing env vars"); process.exit(1)
}

async function karbonFetchAll(endpoint) {
  const all = []
  let url = KARBON_BASE + endpoint
  let page = 0
  while (url) {
    page++
    console.log("  Fetching page " + page + "...")
    const res = await fetch(url, { headers: KARBON_HEADERS })
    if (!res.ok) { console.error("Karbon API error: " + res.status + " " + (await res.text())); break }
    const data = await res.json()
    const items = data.value || data
    if (Array.isArray(items)) all.push(...items)
    else if (items) all.push(items)
    url = data["@odata.nextLink"] || null
  }
  return all
}

async function sbUpsert(table, data, conflictCol) {
  // Use Supabase REST API with on_conflict parameter and Prefer: resolution=merge-duplicates
  const batchSize = 100
  let synced = 0
  let errors = 0
  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize)
    const url = SB_URL + "/rest/v1/" + table + "?on_conflict=" + conflictCol
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "apikey": SB_KEY,
        "Authorization": "Bearer " + SB_KEY,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates"
      },
      body: JSON.stringify(batch)
    })
    if (!res.ok) {
      const errText = await res.text()
      console.error("  Supabase error batch " + Math.floor(i/batchSize) + ": " + errText.substring(0, 300))
      errors += batch.length
    } else {
      synced += batch.length
    }
  }
  return { synced: synced, errors: errors }
}

async function syncContacts() {
  console.log("\n=== SYNCING CONTACTS ===")
  const raw = await karbonFetchAll("/Contacts")
  console.log("Fetched " + raw.length + " contacts from Karbon")

  const mapped = raw.map(function(c) {
    var bc = Array.isArray(c.BusinessCards) ? c.BusinessCards : []
    var card = bc.find(function(x) { return x.IsPrimaryCard }) || bc[0] || {}
    var emails = card.EmailAddresses || []
    var primaryEmail = Array.isArray(emails) ? emails[0] : emails
    var phones = Array.isArray(card.PhoneNumbers) ? card.PhoneNumbers : []
    var primaryPhone = phones[0]
    var addrs = Array.isArray(card.Addresses) ? card.Addresses : []
    var addr = addrs[0] || {}

    return {
      karbon_contact_key: c.ContactKey,
      first_name: c.FirstName || null,
      last_name: c.LastName || null,
      middle_name: c.MiddleName || null,
      preferred_name: c.PreferredName || null,
      salutation: c.Salutation || null,
      suffix: c.Suffix || null,
      prefix: c.Prefix || null,
      // full_name is GENERATED - do NOT include
      contact_type: c.ContactType || "Individual",
      entity_type: "Individual",
      status: c.Status || "Active",
      primary_email: c.EmailAddress || primaryEmail || null,
      phone_primary: c.PhoneNumber || (primaryPhone && primaryPhone.Number ? String(primaryPhone.Number) : null),
      address_line1: addr.AddressLines || addr.Street || null,
      city: addr.City || null,
      state: addr.StateProvinceCounty || addr.State || null,
      zip_code: addr.ZipCode || addr.PostalCode || null,
      country: addr.CountryCode || addr.Country || null,
      client_owner_key: c.ClientOwnerKey || null,
      client_manager_key: c.ClientManagerKey || null,
      client_partner_key: c.ClientPartnerKey || null,
      user_defined_identifier: c.UserDefinedIdentifier || null,
      business_cards: bc.length > 0 ? bc : null,
      tags: c.Tags || [],
      custom_fields: c.CustomFields || {},
      karbon_url: "https://app2.karbonhq.com/4mTyp9lLRWTC#/contacts/" + c.ContactKey,
      karbon_contact_url: "https://app2.karbonhq.com/4mTyp9lLRWTC#/contacts/" + c.ContactKey,
      karbon_created_at: c.CreatedDateTime || null,
      karbon_modified_at: c.LastModifiedDateTime || null,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  })

  var result = await sbUpsert("contacts", mapped, "karbon_contact_key")
  console.log("Contacts synced: " + result.synced + ", errors: " + result.errors)
  return result
}

async function syncOrganizations() {
  console.log("\n=== SYNCING ORGANIZATIONS ===")
  var raw = await karbonFetchAll("/Organizations")
  console.log("Fetched " + raw.length + " organizations from Karbon")

  var mapped = raw.map(function(o) {
    return {
      karbon_organization_key: o.OrganizationKey,
      name: o.OrganizationName || o.Name || ("Organization " + o.OrganizationKey),
      full_name: o.FullName || o.OrganizationName || null,
      legal_name: o.LegalName || null,
      trading_name: o.TradingName || null,
      description: o.Description || null,
      entity_type: o.EntityType || "Organization",
      contact_type: o.ContactType || null,
      restriction_level: o.RestrictionLevel || null,
      user_defined_identifier: o.UserDefinedIdentifier || null,
      industry: o.Industry || null,
      line_of_business: o.LineOfBusiness || null,
      primary_email: o.EmailAddress || null,
      phone: o.PhoneNumber || null,
      website: o.Website || null,
      client_owner_key: o.ClientOwnerKey || null,
      client_manager_key: o.ClientManagerKey || null,
      client_partner_key: o.ClientPartnerKey || null,
      parent_organization_key: o.ParentOrganizationKey || null,
      karbon_url: "https://app2.karbonhq.com/4mTyp9lLRWTC#/organizations/" + o.OrganizationKey,
      karbon_created_at: o.CreatedDateTime || null,
      karbon_modified_at: o.LastModifiedDateTime || null,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  })

  var result = await sbUpsert("organizations", mapped, "karbon_organization_key")
  console.log("Organizations synced: " + result.synced + ", errors: " + result.errors)
  return result
}

async function main() {
  console.log("========================================")
  console.log("KARBON SYNC Part 1: Contacts & Organizations")
  console.log("========================================")
  var c = await syncContacts()
  var o = await syncOrganizations()
  console.log("\n========================================")
  console.log("PART 1 COMPLETE")
  console.log("Contacts: " + c.synced + " synced, " + c.errors + " errors")
  console.log("Organizations: " + o.synced + " synced, " + o.errors + " errors")
  console.log("========================================")
}

main().catch(function(e) { console.error("FATAL:", e); process.exit(1) })
