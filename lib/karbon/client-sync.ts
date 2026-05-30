/**
 * Karbon Client Sync Module
 * 
 * Provides functions to:
 * 1. Search for existing contacts/organizations in Karbon
 * 2. Create new contacts/organizations in Karbon
 * 3. Sync Karbon contacts to Supabase
 * 
 * Used by Jotform intake webhook to auto-create clients when they don't exist.
 */

import { getKarbonCredentials, karbonFetch } from "@/lib/karbon-api"
import { createClient } from "@supabase/supabase-js"

function getServiceClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY
  if (!url || !key) {
    throw new Error("Supabase service-role credentials are not configured")
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export interface KarbonSearchResult {
  contactKey?: string
  organizationKey?: string
  name: string
  email?: string
  type: "contact" | "organization"
}

export interface CreateKarbonContactResult {
  success: boolean
  contactKey?: string
  organizationKey?: string
  supabaseId?: string
  error?: string
}

/**
 * Search Karbon for a contact by email or name
 */
export async function searchKarbonContacts(
  email?: string,
  name?: string
): Promise<KarbonSearchResult[]> {
  const credentials = getKarbonCredentials()
  if (!credentials) {
    console.warn("Karbon credentials not configured, skipping search")
    return []
  }

  const results: KarbonSearchResult[] = []

  // Search by email first (most reliable)
  if (email) {
    const { data: contacts, error } = await karbonFetch<any[]>(
      "/Contacts",
      credentials,
      {
        queryOptions: {
          filter: `EmailAddress eq '${email}'`,
          top: 5,
        },
      }
    )

    if (!error && contacts) {
      for (const c of contacts) {
        results.push({
          contactKey: c.ContactKey,
          name: c.FullName || `${c.FirstName || ""} ${c.LastName || ""}`.trim(),
          email: c.EmailAddress,
          type: "contact",
        })
      }
    }

    // Also search organizations by email
    const { data: orgs, error: orgError } = await karbonFetch<any[]>(
      "/Organizations",
      credentials,
      {
        queryOptions: {
          filter: `EmailAddress eq '${email}'`,
          top: 5,
        },
      }
    )

    if (!orgError && orgs) {
      for (const o of orgs) {
        results.push({
          organizationKey: o.OrganizationKey,
          name: o.Name,
          email: o.EmailAddress,
          type: "organization",
        })
      }
    }
  }

  // If no email results, search by name
  if (results.length === 0 && name && name.length >= 3) {
    const nameParts = name.trim().split(/\s+/)
    const firstName = nameParts[0]
    const lastName = nameParts.slice(1).join(" ") || nameParts[0]

    // Search contacts by name
    const { data: contacts } = await karbonFetch<any[]>(
      "/Contacts",
      credentials,
      {
        queryOptions: {
          filter: `contains(FullName, '${firstName}')`,
          top: 10,
        },
      }
    )

    if (contacts) {
      for (const c of contacts) {
        const fullName = (c.FullName || "").toLowerCase()
        const searchName = name.toLowerCase()
        // Only include if it's a close match
        if (fullName.includes(searchName) || searchName.includes(fullName)) {
          results.push({
            contactKey: c.ContactKey,
            name: c.FullName || `${c.FirstName || ""} ${c.LastName || ""}`.trim(),
            email: c.EmailAddress,
            type: "contact",
          })
        }
      }
    }
  }

  return results
}

/**
 * Search Karbon for an organization by name
 */
export async function searchKarbonOrganizations(name: string): Promise<KarbonSearchResult[]> {
  const credentials = getKarbonCredentials()
  if (!credentials) {
    console.warn("Karbon credentials not configured, skipping search")
    return []
  }

  const results: KarbonSearchResult[] = []
  const cleanedName = name.replace(/['"]/g, "")

  const { data: orgs, error } = await karbonFetch<any[]>(
    "/Organizations",
    credentials,
    {
      queryOptions: {
        filter: `contains(Name, '${cleanedName}')`,
        top: 10,
      },
    }
  )

  if (!error && orgs) {
    for (const o of orgs) {
      results.push({
        organizationKey: o.OrganizationKey,
        name: o.Name,
        email: o.EmailAddress,
        type: "organization",
      })
    }
  }

  return results
}

/**
 * Create a new contact in Karbon and sync to Supabase
 */
export async function createKarbonContact(data: {
  firstName: string
  lastName: string
  email?: string
  phone?: string
  source?: string
}): Promise<CreateKarbonContactResult> {
  const credentials = getKarbonCredentials()
  if (!credentials) {
    return { success: false, error: "Karbon credentials not configured" }
  }

  const body = {
    FirstName: data.firstName,
    LastName: data.lastName,
    EmailAddress: data.email || null,
    PhoneNumber: data.phone || null,
    ContactType: "Client",
    Source: data.source || "Jotform Intake",
  }

  const { data: result, error } = await karbonFetch<any>(
    "/Contacts",
    credentials,
    { method: "POST", body }
  )

  if (error || !result?.ContactKey) {
    console.error("Failed to create Karbon contact:", error)
    return { success: false, error: error || "No ContactKey returned" }
  }

  const contactKey = result.ContactKey

  // Now sync to Supabase
  try {
    const supabase = getServiceClient()
    const { data: contact, error: insertError } = await supabase
      .from("contacts")
      .insert({
        karbon_contact_key: contactKey,
        first_name: data.firstName,
        last_name: data.lastName,
        // full_name is a GENERATED column in Supabase — never write it.
        primary_email: data.email || null,
        phone_primary: data.phone || null,
        source: data.source || "Jotform Intake",
        status: "Active",
        karbon_url: `https://app2.karbonhq.com/4mTyp9lLRWTC#/contacts/${contactKey}`,
        created_at: new Date().toISOString(),
        last_synced_at: new Date().toISOString(),
      })
      .select("id")
      .single()

    if (insertError) {
      console.error("Failed to sync Karbon contact to Supabase:", insertError)
      return { success: true, contactKey, error: `Karbon created but Supabase sync failed: ${insertError.message}` }
    }

    return { success: true, contactKey, supabaseId: contact.id }
  } catch (err) {
    console.error("Supabase sync error:", err)
    return { success: true, contactKey, error: `Karbon created but Supabase sync failed: ${err}` }
  }
}

/**
 * Create a new organization in Karbon and sync to Supabase
 */
export async function createKarbonOrganization(data: {
  name: string
  email?: string
  phone?: string
  source?: string
}): Promise<CreateKarbonContactResult> {
  const credentials = getKarbonCredentials()
  if (!credentials) {
    return { success: false, error: "Karbon credentials not configured" }
  }

  const body = {
    Name: data.name,
    EmailAddress: data.email || null,
    PhoneNumber: data.phone || null,
  }

  const { data: result, error } = await karbonFetch<any>(
    "/Organizations",
    credentials,
    { method: "POST", body }
  )

  if (error || !result?.OrganizationKey) {
    console.error("Failed to create Karbon organization:", error)
    return { success: false, error: error || "No OrganizationKey returned" }
  }

  const organizationKey = result.OrganizationKey

  // Now sync to Supabase
  try {
    const supabase = getServiceClient()
    const { data: org, error: insertError } = await supabase
      .from("organizations")
      .insert({
        karbon_organization_key: organizationKey,
        name: data.name,
        primary_email: data.email || null,
        phone_primary: data.phone || null,
        source: data.source || "Jotform Intake",
        status: "Active",
        karbon_url: `https://app2.karbonhq.com/4mTyp9lLRWTC#/organizations/${organizationKey}`,
        created_at: new Date().toISOString(),
        last_synced_at: new Date().toISOString(),
      })
      .select("id")
      .single()

    if (insertError) {
      console.error("Failed to sync Karbon organization to Supabase:", insertError)
      return { success: true, organizationKey, error: `Karbon created but Supabase sync failed: ${insertError.message}` }
    }

    return { success: true, organizationKey, supabaseId: org.id }
  } catch (err) {
    console.error("Supabase sync error:", err)
    return { success: true, organizationKey, error: `Karbon created but Supabase sync failed: ${err}` }
  }
}

/**
 * Push an existing Hub contact to Karbon
 *
 * Used when the Hub has auto-created a contact (e.g. from Calendly) that
 * doesn't yet exist in Karbon. This:
 *   1. Reads the contact from Supabase
 *   2. Creates the contact in Karbon
 *   3. Updates the Supabase row with the new karbon_contact_key
 *
 * Idempotent: skips if the contact already has a Karbon key.
 *
 * @returns The Karbon contact key (existing or newly created), or null on failure
 */
export async function pushHubContactToKarbon(
  contactId: string,
  options: { source?: string } = {},
): Promise<{ karbonKey: string | null; alreadyLinked: boolean; error?: string }> {
  const { source = "Calendly Booking" } = options
  const supabase = getServiceClient()

  // 1. Fetch the Hub contact
  const { data: contact, error: fetchErr } = await supabase
    .from("contacts")
    .select("id, first_name, last_name, primary_email, phone_primary, karbon_contact_key")
    .eq("id", contactId)
    .single()

  if (fetchErr || !contact) {
    console.error("[pushHubContactToKarbon] Contact not found:", contactId, fetchErr)
    return { karbonKey: null, alreadyLinked: false, error: fetchErr?.message || "Contact not found" }
  }

  // 2. Already linked? Return early
  if (contact.karbon_contact_key) {
    console.log(`[pushHubContactToKarbon] Contact ${contactId} already has Karbon key ${contact.karbon_contact_key}`)
    return { karbonKey: contact.karbon_contact_key, alreadyLinked: true }
  }

  // 3. Create in Karbon
  const credentials = getKarbonCredentials()
  if (!credentials) {
    console.warn("[pushHubContactToKarbon] Karbon credentials not configured")
    return { karbonKey: null, alreadyLinked: false, error: "Karbon credentials not configured" }
  }

  const firstName = contact.first_name || "Unknown"
  const lastName = contact.last_name || ""
  const body = {
    FirstName: firstName,
    LastName: lastName,
    EmailAddress: contact.primary_email || null,
    PhoneNumber: contact.phone_primary || null,
    ContactType: "Client",
    Source: source,
  }

  const { data: karbonResult, error: karbonErr } = await karbonFetch<any>(
    "/Contacts",
    credentials,
    { method: "POST", body },
  )

  if (karbonErr || !karbonResult?.ContactKey) {
    console.error("[pushHubContactToKarbon] Karbon create failed:", karbonErr)
    return { karbonKey: null, alreadyLinked: false, error: karbonErr || "No ContactKey returned" }
  }

  const karbonKey = karbonResult.ContactKey
  console.log(`[pushHubContactToKarbon] Created Karbon contact ${karbonKey} for Hub contact ${contactId}`)

  // 4. Update Hub row with Karbon key
  const { error: updateErr } = await supabase
    .from("contacts")
    .update({
      karbon_contact_key: karbonKey,
      karbon_url: `https://app2.karbonhq.com/4mTyp9lLRWTC#/contacts/${karbonKey}`,
      last_synced_at: new Date().toISOString(),
    })
    .eq("id", contactId)

  if (updateErr) {
    console.error("[pushHubContactToKarbon] Failed to update Hub contact with Karbon key:", updateErr)
    // Karbon contact exists but Hub update failed — return the key anyway
    return { karbonKey, alreadyLinked: false, error: `Karbon created but Hub update failed: ${updateErr.message}` }
  }

  return { karbonKey, alreadyLinked: false }
}

/**
 * Unified search + create flow for intake submissions.
 * 
 * 1. First searches Supabase (already imported from Karbon)
 * 2. Then searches Karbon directly for any new/unsynced records
 * 3. If not found, creates in Karbon and syncs to Supabase
 * 
 * Returns the contact_id or organization_id to link the submission to.
 */
export async function findOrCreateClient(
  submission: {
    email?: string
    fullName?: string
    businessName?: string
    phone?: string
  },
  options: {
    autoCreate?: boolean
    source?: string
  } = {}
): Promise<{
  contact_id: string | null
  organization_id: string | null
  karbon_key: string | null
  method: "supabase_match" | "karbon_match" | "karbon_created" | "not_found"
  reason: string
}> {
  const { autoCreate = true, source = "Jotform Intake" } = options
  const supabase = getServiceClient()

  const email = submission.email?.trim().toLowerCase()
  const fullName = submission.fullName?.trim()
  const businessName = submission.businessName?.trim()

  // ═══════════════════════════════════════════════════════════════════
  // Step 1: Search Supabase first (fast, already synced from Karbon)
  // ═══════════════════════════════════════════════════════════════════

  // Search contacts by email
  if (email) {
    const { data: contacts } = await supabase
      .from("contacts")
      .select("id, karbon_contact_key, full_name")
      .or(`primary_email.ilike.${email},secondary_email.ilike.${email}`)
      .limit(1)

    if (contacts && contacts.length > 0) {
      return {
        contact_id: contacts[0].id,
        organization_id: null,
        karbon_key: contacts[0].karbon_contact_key,
        method: "supabase_match",
        reason: `Found contact in Supabase: ${contacts[0].full_name} (email: ${email})`,
      }
    }

    // Search organizations by email
    const { data: orgs } = await supabase
      .from("organizations")
      .select("id, karbon_organization_key, name")
      .ilike("primary_email", email)
      .limit(1)

    if (orgs && orgs.length > 0) {
      return {
        contact_id: null,
        organization_id: orgs[0].id,
        karbon_key: orgs[0].karbon_organization_key,
        method: "supabase_match",
        reason: `Found organization in Supabase: ${orgs[0].name} (email: ${email})`,
      }
    }
  }

  // Search organizations by business name
  if (businessName && businessName.length >= 3) {
    const cleanedName = businessName
      .toLowerCase()
      .replace(/\b(llc|inc|corp|co|ltd|pllc)\b/gi, "")
      .replace(/[^a-z0-9 ]/g, " ")
      .replace(/\s+/g, " ")
      .trim()

    if (cleanedName.length >= 3) {
      const { data: orgs } = await supabase
        .from("organizations")
        .select("id, karbon_organization_key, name")
        .ilike("name", `%${cleanedName}%`)
        .limit(5)

      // Filter for exact-ish match
      const match = (orgs || []).find((o) => {
        const orgClean = o.name
          .toLowerCase()
          .replace(/\b(llc|inc|corp|co|ltd|pllc)\b/gi, "")
          .replace(/[^a-z0-9 ]/g, " ")
          .replace(/\s+/g, " ")
          .trim()
        return orgClean === cleanedName
      })

      if (match) {
        return {
          contact_id: null,
          organization_id: match.id,
          karbon_key: match.karbon_organization_key,
          method: "supabase_match",
          reason: `Found organization in Supabase by name: ${match.name}`,
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Step 2: Search Karbon directly (may have unsynced records)
  // ═══════════════════════════════════════════════════════════════════

  const karbonResults = await searchKarbonContacts(email, fullName)

  if (karbonResults.length > 0) {
    const match = karbonResults[0]

    // Sync this Karbon record to Supabase
    if (match.type === "contact" && match.contactKey) {
      // Check if already in Supabase
      const { data: existing } = await supabase
        .from("contacts")
        .select("id")
        .eq("karbon_contact_key", match.contactKey)
        .maybeSingle()

      if (existing) {
        return {
          contact_id: existing.id,
          organization_id: null,
          karbon_key: match.contactKey,
          method: "karbon_match",
          reason: `Found contact in Karbon (already in Supabase): ${match.name}`,
        }
      }

      // Need to import from Karbon
      const nameParts = (match.name || "").split(/\s+/)
      const { data: newContact } = await supabase
        .from("contacts")
        .insert({
          karbon_contact_key: match.contactKey,
          first_name: nameParts[0] || "",
          last_name: nameParts.slice(1).join(" ") || "",
          // full_name is a GENERATED column in Supabase — never write it.
          primary_email: match.email || null,
          status: "Active",
          karbon_url: `https://app2.karbonhq.com/4mTyp9lLRWTC#/contacts/${match.contactKey}`,
          created_at: new Date().toISOString(),
          last_synced_at: new Date().toISOString(),
        })
        .select("id")
        .single()

      if (newContact) {
        return {
          contact_id: newContact.id,
          organization_id: null,
          karbon_key: match.contactKey,
          method: "karbon_match",
          reason: `Found contact in Karbon and synced to Supabase: ${match.name}`,
        }
      }
    }

    if (match.type === "organization" && match.organizationKey) {
      const { data: existing } = await supabase
        .from("organizations")
        .select("id")
        .eq("karbon_organization_key", match.organizationKey)
        .maybeSingle()

      if (existing) {
        return {
          contact_id: null,
          organization_id: existing.id,
          karbon_key: match.organizationKey,
          method: "karbon_match",
          reason: `Found organization in Karbon (already in Supabase): ${match.name}`,
        }
      }

      const { data: newOrg } = await supabase
        .from("organizations")
        .insert({
          karbon_organization_key: match.organizationKey,
          name: match.name,
          primary_email: match.email || null,
          status: "Active",
          karbon_url: `https://app2.karbonhq.com/4mTyp9lLRWTC#/organizations/${match.organizationKey}`,
          created_at: new Date().toISOString(),
          last_synced_at: new Date().toISOString(),
        })
        .select("id")
        .single()

      if (newOrg) {
        return {
          contact_id: null,
          organization_id: newOrg.id,
          karbon_key: match.organizationKey,
          method: "karbon_match",
          reason: `Found organization in Karbon and synced to Supabase: ${match.name}`,
        }
      }
    }
  }

  // Also search Karbon for organization by business name
  if (businessName && businessName.length >= 3) {
    const orgResults = await searchKarbonOrganizations(businessName)

    if (orgResults.length > 0) {
      const match = orgResults[0]

      if (match.organizationKey) {
        const { data: existing } = await supabase
          .from("organizations")
          .select("id")
          .eq("karbon_organization_key", match.organizationKey)
          .maybeSingle()

        if (existing) {
          return {
            contact_id: null,
            organization_id: existing.id,
            karbon_key: match.organizationKey,
            method: "karbon_match",
            reason: `Found organization in Karbon by business name: ${match.name}`,
          }
        }

        const { data: newOrg } = await supabase
          .from("organizations")
          .insert({
            karbon_organization_key: match.organizationKey,
            name: match.name,
            primary_email: match.email || null,
            status: "Active",
            karbon_url: `https://app2.karbonhq.com/4mTyp9lLRWTC#/organizations/${match.organizationKey}`,
            created_at: new Date().toISOString(),
            last_synced_at: new Date().toISOString(),
          })
          .select("id")
          .single()

        if (newOrg) {
          return {
            contact_id: null,
            organization_id: newOrg.id,
            karbon_key: match.organizationKey,
            method: "karbon_match",
            reason: `Found organization in Karbon by business name and synced: ${match.name}`,
          }
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Step 3: Create new client in Karbon if autoCreate is enabled
  // ═══════════════════════════════════════════════════════════════════

  if (!autoCreate) {
    return {
      contact_id: null,
      organization_id: null,
      karbon_key: null,
      method: "not_found",
      reason: "No matching client found (autoCreate disabled)",
    }
  }

  // Decide whether to create contact or organization
  const shouldCreateOrg = businessName && businessName.length >= 3
  const nameParts = (fullName || "").split(/\s+/)
  const firstName = nameParts[0] || ""
  const lastName = nameParts.slice(1).join(" ") || ""

  // Need at least a name to create
  if (!shouldCreateOrg && (!firstName || !lastName)) {
    return {
      contact_id: null,
      organization_id: null,
      karbon_key: null,
      method: "not_found",
      reason: "Insufficient data to create client (need first+last name or business name)",
    }
  }

  if (shouldCreateOrg) {
    const result = await createKarbonOrganization({
      name: businessName!,
      email,
      phone: submission.phone,
      source,
    })

    if (result.success && result.supabaseId) {
      return {
        contact_id: null,
        organization_id: result.supabaseId,
        karbon_key: result.organizationKey || null,
        method: "karbon_created",
        reason: `Created new organization in Karbon: ${businessName}`,
      }
    }
  } else {
    const result = await createKarbonContact({
      firstName,
      lastName,
      email,
      phone: submission.phone,
      source,
    })

    if (result.success && result.supabaseId) {
      return {
        contact_id: result.supabaseId,
        organization_id: null,
        karbon_key: result.contactKey || null,
        method: "karbon_created",
        reason: `Created new contact in Karbon: ${firstName} ${lastName}`,
      }
    }
  }

  return {
    contact_id: null,
    organization_id: null,
    karbon_key: null,
    method: "not_found",
    reason: "Failed to create client in Karbon",
  }
}
