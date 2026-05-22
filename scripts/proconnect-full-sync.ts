/**
 * ProConnect Comprehensive Sync Script
 *
 * Run with: npx tsx scripts/proconnect-full-sync.ts
 *
 * This script performs a full sync of all ProConnect data:
 * 1. Clients (with Hub contact matching)
 * 2. Engagements (all tax years 2021-2026)
 * 3. Custom statuses
 * 4. Profiles (map ProConnect profile IDs to names)
 *
 * Unlike the Edge Function, this runs without timeout constraints.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js"

// Load env vars
const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const PROCONNECT_CLIENT_ID = process.env.PROCONNECT_CLIENT_ID!
const PROCONNECT_CLIENT_SECRET = process.env.PROCONNECT_CLIENT_SECRET!

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

if (!PROCONNECT_CLIENT_ID || !PROCONNECT_CLIENT_SECRET) {
  console.error("Missing PROCONNECT_CLIENT_ID or PROCONNECT_CLIENT_SECRET")
  process.exit(1)
}

// Tax years to sync
const TAX_YEARS = [2021, 2022, 2023, 2024, 2025, 2026]

// Parallel processing settings
const PARALLEL_CLIENTS = 5
const PARALLEL_ENGAGEMENTS = 3

// API base URLs
const CLIENT_SERVICE_BASE = "https://public.api.intuit.com/tax/v2"
const ENGAGEMENT_SERVICE_BASE = "https://public.api.intuit.com/tax/v2"

interface TokenData {
  access_token: string
  refresh_token: string
  expires_at: string
  realm_id: string
}

interface SyncStats {
  clientsTotal: number
  clientsSynced: number
  engagementsTotal: number
  engagementsSynced: number
  customStatusesSynced: number
  profilesDiscovered: number
  errors: string[]
  startTime: number
}

const stats: SyncStats = {
  clientsTotal: 0,
  clientsSynced: 0,
  engagementsTotal: 0,
  engagementsSynced: 0,
  customStatusesSynced: 0,
  profilesDiscovered: 0,
  errors: [],
  startTime: Date.now(),
}

function getSupabase(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// OAuth Token Management
// ─────────────────────────────────────────────────────────────────────────────

async function getAccessToken(supabase: SupabaseClient): Promise<string> {
  // Get current token from DB
  const { data: tokenRow, error } = await supabase
    .from("proconnect_oauth_tokens")
    .select("*")
    .eq("is_singleton", true)
    .single()

  if (error || !tokenRow) {
    throw new Error("No ProConnect OAuth token found. Please authorize first.")
  }

  const token = tokenRow as TokenData

  // Check if expired (with 5 min buffer)
  const expiresAt = new Date(token.expires_at).getTime()
  const now = Date.now()
  const needsRefresh = expiresAt - now < 5 * 60 * 1000

  if (needsRefresh) {
    console.log("[OAuth] Token needs refresh, refreshing...")
    return await refreshToken(supabase, token.refresh_token)
  }

  return token.access_token
}

async function refreshToken(supabase: SupabaseClient, refreshToken: string): Promise<string> {
  const tokenUrl = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${PROCONNECT_CLIENT_ID}:${PROCONNECT_CLIENT_SECRET}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Token refresh failed: ${response.status} ${text}`)
  }

  const data = await response.json()

  // Calculate expiry
  const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString()

  // Update DB
  await supabase
    .from("proconnect_oauth_tokens")
    .update({
      access_token: data.access_token,
      refresh_token: data.refresh_token || refreshToken,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("is_singleton", true)

  console.log("[OAuth] Token refreshed successfully")
  return data.access_token
}

// ─────────────────────────────────────────────────────────────────────────────
// API Fetch Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function fetchWithAuth(
  supabase: SupabaseClient,
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const accessToken = await getAccessToken(supabase)

  const response = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  })

  return response
}

async function fetchClients(supabase: SupabaseClient): Promise<unknown[]> {
  console.log("[Clients] Fetching all clients...")

  const url = `${CLIENT_SERVICE_BASE}/clients`
  const response = await fetchWithAuth(supabase, url)

  if (!response.ok) {
    throw new Error(`Failed to fetch clients: ${response.status}`)
  }

  const data = await response.json()
  const clients = Array.isArray(data) ? data : data.clients || data.data || []

  console.log(`[Clients] Found ${clients.length} clients`)
  return clients
}

async function fetchEngagements(
  supabase: SupabaseClient,
  clientId: string,
  taxYear: number
): Promise<unknown[]> {
  const url = `${ENGAGEMENT_SERVICE_BASE}/taxreturns?clientId=${clientId}&taxYear=${taxYear}`
  const response = await fetchWithAuth(supabase, url)

  if (!response.ok) {
    if (response.status === 404) return []
    throw new Error(`Engagements ${clientId}/${taxYear}: ${response.status}`)
  }

  const data = await response.json()
  return Array.isArray(data) ? data : data.taxReturns || data.engagements || data.data || []
}

async function fetchCustomStatuses(supabase: SupabaseClient): Promise<unknown[]> {
  console.log("[Statuses] Fetching custom statuses...")

  const url = `${ENGAGEMENT_SERVICE_BASE}/userDefinedStatuses`
  const response = await fetchWithAuth(supabase, url)

  if (!response.ok) {
    if (response.status === 404) {
      console.log("[Statuses] No custom statuses endpoint (404)")
      return []
    }
    throw new Error(`Failed to fetch custom statuses: ${response.status}`)
  }

  const data = await response.json()
  const statuses = Array.isArray(data) ? data : data.statuses || data.userDefinedStatuses || data.data || []

  console.log(`[Statuses] Found ${statuses.length} custom statuses`)
  return statuses
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync Functions
// ─────────────────────────────────────────────────────────────────────────────

function extractClientData(client: Record<string, unknown>) {
  // Extract client ID
  const clientId =
    (client.id as string) ||
    (client.clientId as string) ||
    (client.topLevelEntityId as string) ||
    null

  // Extract names
  const firstName = (client.firstName as string) || null
  const lastName = (client.lastName as string) || null
  const businessName = (client.businessName as string) || (client.name as string) || null

  // Build display name
  let displayName = businessName
  if (!displayName && firstName) {
    displayName = lastName ? `${firstName} ${lastName}` : firstName
  }

  // Extract email
  const email =
    (client.email as string) ||
    (client.primaryEmail as string) ||
    ((client.emails as unknown[])?.[0] as Record<string, string>)?.address ||
    null

  // Extract other fields
  const phone = (client.phone as string) || (client.primaryPhone as string) || null
  const city = (client.city as string) || null
  const state = (client.state as string) || null
  const zip = (client.zip as string) || (client.zipCode as string) || null
  const clientType = (client.clientType as string) || (client.type as string) || null
  const clientState = (client.clientState as string) || (client.status as string) || null
  const taxId = (client.taxId as string) || (client.ssn as string) || (client.ein as string) || null
  const topLevelEntityId = (client.topLevelEntityId as string) || null
  const entityId = (client.entityId as string) || null

  return {
    clientId,
    firstName,
    lastName,
    businessName,
    displayName,
    email,
    phone,
    city,
    state,
    zip,
    clientType,
    clientState,
    taxId,
    topLevelEntityId,
    entityId,
  }
}

async function matchClientToContact(
  supabase: SupabaseClient,
  email: string | null
): Promise<string | null> {
  if (!email) return null

  const { data } = await supabase
    .from("contacts")
    .select("id")
    .ilike("primary_email", email)
    .limit(1)
    .single()

  return data?.id || null
}

async function syncClients(supabase: SupabaseClient): Promise<void> {
  console.log("\n" + "=".repeat(60))
  console.log("SYNCING CLIENTS")
  console.log("=".repeat(60))

  const clients = await fetchClients(supabase)
  stats.clientsTotal = clients.length

  for (let i = 0; i < clients.length; i++) {
    const client = clients[i] as Record<string, unknown>

    try {
      const data = extractClientData(client)

      if (!data.clientId) {
        stats.errors.push(`Client at index ${i} missing ID`)
        continue
      }

      // Match to Hub contact
      const hubContactId = await matchClientToContact(supabase, data.email)

      const { error } = await supabase.from("proconnect_clients").upsert(
        {
          proconnect_client_id: data.clientId,
          first_name: data.firstName,
          last_name: data.lastName,
          business_name: data.businessName,
          display_name: data.displayName,
          name_for_matching: data.displayName?.toLowerCase(),
          email: data.email,
          phone: data.phone,
          city: data.city,
          state: data.state,
          zip: data.zip,
          client_type: data.clientType,
          client_state: data.clientState,
          tax_id: data.taxId,
          top_level_entity_id: data.topLevelEntityId,
          proconnect_entity_id: data.entityId,
          hub_contact_id: hubContactId,
          raw_json: client,
          synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "proconnect_client_id" }
      )

      if (error) {
        stats.errors.push(`Client ${data.clientId}: ${error.message}`)
      } else {
        stats.clientsSynced++
      }

      // Progress every 20 clients
      if ((i + 1) % 20 === 0 || i === clients.length - 1) {
        console.log(`[Clients] ${i + 1}/${clients.length} processed`)
      }
    } catch (err) {
      stats.errors.push(`Client index ${i}: ${err instanceof Error ? err.message : "Unknown"}`)
    }
  }

  console.log(`[Clients] Synced ${stats.clientsSynced}/${stats.clientsTotal}`)
}

async function syncEngagements(supabase: SupabaseClient): Promise<void> {
  console.log("\n" + "=".repeat(60))
  console.log("SYNCING ENGAGEMENTS")
  console.log("=".repeat(60))

  // Get all client IDs
  const { data: clients, error } = await supabase
    .from("proconnect_clients")
    .select("proconnect_client_id")
    .order("proconnect_client_id")

  if (error || !clients) {
    throw new Error(`Failed to get clients: ${error?.message}`)
  }

  console.log(`[Engagements] Processing ${clients.length} clients × ${TAX_YEARS.length} years`)

  const profileIds = new Set<string>()

  // Process clients in batches
  for (let i = 0; i < clients.length; i += PARALLEL_CLIENTS) {
    const batch = clients.slice(i, i + PARALLEL_CLIENTS)

    await Promise.all(
      batch.map(async (client) => {
        const clientId = client.proconnect_client_id
        if (!clientId) return

        // Process all tax years for this client
        for (const year of TAX_YEARS) {
          try {
            const engagements = await fetchEngagements(supabase, clientId, year)

            for (const engagement of engagements) {
              const eng = engagement as Record<string, unknown>

              const engagementId = (eng.id as string) || (eng.engagementId as string)
              if (!engagementId) continue

              // Extract fields
              const formType = (eng.type as string) || (eng.formType as string) || null
              const returnType = formType
              const status = (eng.status as string) || null
              const efileStatus = (eng.efileStatus as string) || null
              const workStatus = (eng.workStatus as string) || null
              const engagementState = (eng.state as string) || (eng.engagementState as string) || null
              const engagementName = (eng.name as string) || (eng.engagementName as string) || null
              const userDefinedStatusId = (eng.userDefinedStatusId as string) || (eng.customStatusId as string) || null

              // Extract profile IDs for discovery
              const assigneeProfileId = (eng.assigneeProfileId as string) || (eng.assignee?.profileId as string) || null
              const createdByProfileId = (eng.createdByProfileId as string) || (eng.createdBy?.profileId as string) || null
              const modifiedByProfileId = (eng.modifiedByProfileId as string) || (eng.modifiedBy?.profileId as string) || null
              const assigneeAuthId = (eng.assigneeAuthId as string) || (eng.assignee?.authId as string) || null

              if (assigneeProfileId) profileIds.add(assigneeProfileId)
              if (createdByProfileId) profileIds.add(createdByProfileId)
              if (modifiedByProfileId) profileIds.add(modifiedByProfileId)

              // Timestamps
              const proconnectCreatedAt = (eng.createdTime as string) || (eng.createdAt as string) || null
              const proconnectModifiedAt = (eng.modifiedTime as string) || (eng.modifiedAt as string) || (eng.updatedAt as string) || null

              const { error: upsertError } = await supabase.from("proconnect_engagements").upsert(
                {
                  engagement_id: engagementId,
                  proconnect_client_id: clientId,
                  tax_year: year,
                  return_type: returnType,
                  form_type: formType,
                  status,
                  efile_status: efileStatus,
                  work_status: workStatus,
                  engagement_state: engagementState,
                  engagement_name: engagementName,
                  user_defined_status_id: userDefinedStatusId,
                  assignee_profile_id: assigneeProfileId,
                  assignee_auth_id: assigneeAuthId,
                  created_by_profile_id: createdByProfileId,
                  modified_by_profile_id: modifiedByProfileId,
                  proconnect_created_at: proconnectCreatedAt,
                  proconnect_modified_at: proconnectModifiedAt,
                  raw_json: engagement,
                  synced_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                },
                { onConflict: "engagement_id" }
              )

              if (upsertError) {
                stats.errors.push(`Engagement ${engagementId}: ${upsertError.message}`)
              } else {
                stats.engagementsSynced++
                stats.engagementsTotal++
              }
            }
          } catch (err) {
            // 404 is expected for clients with no returns in that year
            const msg = err instanceof Error ? err.message : "Unknown"
            if (!msg.includes("404")) {
              stats.errors.push(`${clientId}/${year}: ${msg}`)
            }
          }
        }
      })
    )

    // Progress
    const processed = Math.min(i + PARALLEL_CLIENTS, clients.length)
    console.log(
      `[Engagements] ${processed}/${clients.length} clients, ${stats.engagementsSynced} engagements`
    )
  }

  // Discover new profile IDs
  stats.profilesDiscovered = profileIds.size
  console.log(`[Engagements] Discovered ${profileIds.size} unique profile IDs`)

  // Insert any new profile IDs (without names - those need manual mapping)
  for (const profileId of profileIds) {
    await supabase.from("proconnect_profiles").upsert(
      {
        proconnect_profile_id: profileId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "proconnect_profile_id", ignoreDuplicates: true }
    )
  }

  console.log(`[Engagements] Synced ${stats.engagementsSynced} engagements`)
}

async function syncCustomStatuses(supabase: SupabaseClient): Promise<void> {
  console.log("\n" + "=".repeat(60))
  console.log("SYNCING CUSTOM STATUSES")
  console.log("=".repeat(60))

  const statuses = await fetchCustomStatuses(supabase)

  for (const status of statuses) {
    const s = status as Record<string, unknown>

    const statusId = (s.id as string) || (s.statusId as string)
    if (!statusId) continue

    const { error } = await supabase.from("proconnect_custom_statuses").upsert(
      {
        status_id: statusId,
        name: (s.name as string) || "Unknown",
        description: (s.description as string) || null,
        color: (s.color as string) || null,
        sort_order: (s.sortOrder as number) || (s.order as number) || null,
        is_active: (s.isActive as boolean) ?? (s.active as boolean) ?? true,
        raw_json: status,
        synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "status_id" }
    )

    if (error) {
      stats.errors.push(`Status ${statusId}: ${error.message}`)
    } else {
      stats.customStatusesSynced++
    }
  }

  console.log(`[Statuses] Synced ${stats.customStatusesSynced} custom statuses`)
}

async function createSyncLog(supabase: SupabaseClient): Promise<string> {
  const { data, error } = await supabase
    .from("proconnect_sync_logs")
    .insert({
      sync_type: "full_script",
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single()

  if (error) throw new Error(`Failed to create sync log: ${error.message}`)
  return data.id
}

async function updateSyncLog(
  supabase: SupabaseClient,
  logId: string,
  success: boolean
): Promise<void> {
  const duration = Date.now() - stats.startTime

  await supabase
    .from("proconnect_sync_logs")
    .update({
      status: success ? "success" : "failed",
      clients_synced: stats.clientsSynced,
      engagements_synced: stats.engagementsSynced,
      custom_statuses_synced: stats.customStatusesSynced,
      error_message: success
        ? `Full sync complete in ${Math.round(duration / 1000)}s`
        : `${stats.errors.length} errors - see error_details`,
      error_details: stats.errors.length > 0 ? { errors: stats.errors.slice(0, 100) } : null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", logId)
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n" + "=".repeat(60))
  console.log("PROCONNECT COMPREHENSIVE SYNC")
  console.log("=".repeat(60))
  console.log(`Started at: ${new Date().toISOString()}`)

  const supabase = getSupabase()

  // Create sync log
  const syncLogId = await createSyncLog(supabase)
  console.log(`Sync log ID: ${syncLogId}`)

  let success = false

  try {
    // 1. Sync clients
    await syncClients(supabase)

    // 2. Sync engagements (with profile discovery)
    await syncEngagements(supabase)

    // 3. Sync custom statuses
    await syncCustomStatuses(supabase)

    success = stats.errors.length === 0

    console.log("\n" + "=".repeat(60))
    console.log("SYNC COMPLETE")
    console.log("=".repeat(60))
    console.log(`Duration: ${Math.round((Date.now() - stats.startTime) / 1000)}s`)
    console.log(`Clients: ${stats.clientsSynced}/${stats.clientsTotal}`)
    console.log(`Engagements: ${stats.engagementsSynced}`)
    console.log(`Custom Statuses: ${stats.customStatusesSynced}`)
    console.log(`Profiles Discovered: ${stats.profilesDiscovered}`)
    console.log(`Errors: ${stats.errors.length}`)

    if (stats.errors.length > 0) {
      console.log("\nFirst 10 errors:")
      stats.errors.slice(0, 10).forEach((e) => console.log(`  - ${e}`))
    }
  } catch (err) {
    console.error("\nFATAL ERROR:", err)
    stats.errors.push(err instanceof Error ? err.message : "Unknown fatal error")
  }

  // Update sync log
  await updateSyncLog(supabase, syncLogId, success)

  console.log("\nDone!")
}

main().catch(console.error)
