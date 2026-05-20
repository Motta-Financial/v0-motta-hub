/**
 * ProConnect Sync Orchestrator
 *
 * Coordinates the full sync: clients → engagements → custom statuses.
 * All data is upserted with full JSONB payloads to preserve every field
 * the API returns.
 *
 * Tax years synced: 2021–2026 (configurable)
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js"
import {
  fetchClients,
  fetchEngagements,
  fetchCustomStatuses,
  extractClientEmail,
  extractClientId,
  extractClientName,
  RETURN_TYPE_MAP,
} from "./client"

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Tax years to sync (inclusive)
const TAX_YEARS = [2021, 2022, 2023, 2024, 2025, 2026]

// Batch size for client processing (to avoid timeouts)
const CLIENT_BATCH_SIZE = 20

// Max execution time before we gracefully stop (Vercel timeout is 60s for hobby, 300s for pro)
// Leave 10s buffer for cleanup
const MAX_EXECUTION_MS = 50_000

interface SyncResult {
  success: boolean
  syncLogId: string
  clientsSynced: number
  engagementsSynced: number
  customStatusesSynced: number
  errors: string[]
  duration: number
  timedOut?: boolean
}

interface SyncLog {
  id: string
  sync_type: string
  status: string
  clients_synced: number
  engagements_synced: number
  custom_statuses_synced: number
  error_message: string | null
  error_details: unknown
  started_at: string
  completed_at: string | null
}

/**
 * Get a Supabase client with service role
 */
function getSupabaseAdmin(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })
}

/**
 * Create a sync log entry
 */
async function createSyncLog(
  supabase: SupabaseClient,
  syncType: string
): Promise<string> {
  const { data, error } = await supabase
    .from("proconnect_sync_logs")
    .insert({
      sync_type: syncType,
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single()

  if (error) throw new Error(`Failed to create sync log: ${error.message}`)
  return data.id
}

/**
 * Update sync log with results
 */
async function updateSyncLog(
  supabase: SupabaseClient,
  logId: string,
  result: Partial<SyncLog>
): Promise<void> {
  const { error } = await supabase
    .from("proconnect_sync_logs")
    .update({
      ...result,
      completed_at: new Date().toISOString(),
    })
    .eq("id", logId)

  if (error) {
    console.error(`Failed to update sync log: ${error.message}`)
  }
}

/**
 * Get consecutive failure count
 */
async function getConsecutiveFailureCount(
  supabase: SupabaseClient
): Promise<number> {
  const { data, error } = await supabase
    .from("proconnect_sync_logs")
    .select("status")
    .order("started_at", { ascending: false })
    .limit(10)

  if (error || !data) return 0

  let count = 0
  for (const log of data) {
    if (log.status === "failed") {
      count++
    } else {
      break
    }
  }
  return count
}

/**
 * Match client email to Hub contact
 */
async function matchClientToContact(
  supabase: SupabaseClient,
  email: string | null
): Promise<string | null> {
  if (!email) return null

  const { data, error } = await supabase
    .from("contacts")
    .select("id")
    .ilike("primary_email", email)
    .limit(1)
    .single()

  if (error || !data) return null
  return data.id
}

/**
 * Sync all clients from ProConnect
 */
async function syncClients(
  supabase: SupabaseClient
): Promise<{ count: number; errors: string[] }> {
  console.log("[ProConnect Sync] Fetching clients...")

  const response = await fetchClients()

  if (!response.ok || !response.data) {
    return { count: 0, errors: [response.error || "Failed to fetch clients"] }
  }

  const clients = response.data
  console.log(`[ProConnect Sync] Found ${clients.length} clients`)

  let count = 0
  const errors: string[] = []

  for (const client of clients) {
    try {
      const clientId = extractClientId(client)
      if (!clientId) {
        errors.push(`Client missing ID: ${JSON.stringify(client).slice(0, 100)}`)
        continue
      }

      const email = extractClientEmail(client)
      const names = extractClientName(client)
      const hubContactId = await matchClientToContact(supabase, email)

      // Upsert client
      const { error } = await supabase
        .from("proconnect_clients")
        .upsert(
          {
            proconnect_client_id: clientId,
            email,
            first_name: names.firstName,
            last_name: names.lastName,
            business_name: names.businessName,
            display_name: names.displayName,
            name_for_matching: names.displayName?.toLowerCase(),
            raw_json: client,
            hub_contact_id: hubContactId,
            synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "proconnect_client_id" }
        )

      if (error) {
        errors.push(`Client ${clientId}: ${error.message}`)
      } else {
        count++
      }
    } catch (err) {
      errors.push(
        `Client error: ${err instanceof Error ? err.message : "Unknown"}`
      )
    }
  }

  console.log(`[ProConnect Sync] Synced ${count} clients`)
  return { count, errors }
}

/**
 * Sync engagements for all clients across all tax years.
 * Processes in batches with timeout awareness to avoid serverless timeouts.
 */
async function syncEngagements(
  supabase: SupabaseClient,
  startTime: number
): Promise<{ count: number; errors: string[]; timedOut: boolean }> {
  console.log("[ProConnect Sync] Fetching engagements...")

  // Get all client IDs
  const { data: clients, error: clientError } = await supabase
    .from("proconnect_clients")
    .select("proconnect_client_id")

  if (clientError || !clients) {
    return {
      count: 0,
      errors: [clientError?.message || "Failed to get client IDs"],
      timedOut: false,
    }
  }

  let count = 0
  const errors: string[] = []
  let timedOut = false

  // Process clients in batches
  for (let i = 0; i < clients.length; i++) {
    // Check timeout before processing each client
    const elapsed = Date.now() - startTime
    if (elapsed > MAX_EXECUTION_MS) {
      console.log(
        `[ProConnect Sync] Timeout approaching after ${i} clients, stopping gracefully`
      )
      timedOut = true
      break
    }

    const client = clients[i]
    const clientId = client.proconnect_client_id

    for (const year of TAX_YEARS) {
      try {
        const response = await fetchEngagements(clientId, year)

        if (!response.ok) {
          // 404 is expected if client has no engagements for that year
          if (response.status !== 404) {
            errors.push(
              `Engagements ${clientId}/${year}: ${response.error}`
            )
          }
          continue
        }

        if (!response.data || response.data.length === 0) continue

        for (const engagement of response.data) {
          const eng = engagement as Record<string, unknown>
          const engagementId =
            (eng.id as string) ||
            (eng.engagementId as string) ||
            `${clientId}-${year}`

          // Extract return type
          const returnType = (eng.returnType as string) || null
          const formType = returnType ? RETURN_TYPE_MAP[returnType] : null

          const { error } = await supabase
            .from("proconnect_engagements")
            .upsert(
              {
                engagement_id: engagementId,
                proconnect_client_id: clientId,
                tax_year: year,
                return_type: returnType,
                form_type: formType,
                status: (eng.status as string) || null,
                efile_status: (eng.efileStatus as string) || null,
                work_status: (eng.workStatus as string) || null,
                raw_json: engagement,
                synced_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
              {
                onConflict: "proconnect_client_id,tax_year,return_type",
              }
            )

          if (error) {
            errors.push(`Engagement ${engagementId}: ${error.message}`)
          } else {
            count++
          }
        }
      } catch (err) {
        errors.push(
          `Engagement ${clientId}/${year}: ${err instanceof Error ? err.message : "Unknown"}`
        )
      }
    }

    // Log progress every batch
    if ((i + 1) % CLIENT_BATCH_SIZE === 0) {
      console.log(
        `[ProConnect Sync] Progress: ${i + 1}/${clients.length} clients, ${count} engagements`
      )
    }
  }

  console.log(`[ProConnect Sync] Synced ${count} engagements${timedOut ? " (timed out)" : ""}`)
  return { count, errors, timedOut }
}

/**
 * Sync custom statuses
 */
async function syncCustomStatuses(
  supabase: SupabaseClient
): Promise<{ count: number; errors: string[] }> {
  console.log("[ProConnect Sync] Fetching custom statuses...")

  const response = await fetchCustomStatuses()

  if (!response.ok || !response.data) {
    // Not all ProConnect accounts have custom statuses
    if (response.status === 404) {
      return { count: 0, errors: [] }
    }
    return {
      count: 0,
      errors: [response.error || "Failed to fetch custom statuses"],
    }
  }

  let count = 0
  const errors: string[] = []

  for (const status of response.data) {
    try {
      const s = status as Record<string, unknown>
      const statusId =
        (s.id as string) || (s.statusId as string) || String(Math.random())

      const { error } = await supabase
        .from("proconnect_custom_statuses")
        .upsert(
          {
            status_id: statusId,
            name: (s.name as string) || "Unknown",
            description: (s.description as string) || null,
            color: (s.color as string) || null,
            sort_order: (s.sortOrder as number) || null,
            is_active: (s.isActive as boolean) ?? true,
            raw_json: status,
            synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "status_id" }
        )

      if (error) {
        errors.push(`Status ${statusId}: ${error.message}`)
      } else {
        count++
      }
    } catch (err) {
      errors.push(
        `Status error: ${err instanceof Error ? err.message : "Unknown"}`
      )
    }
  }

  console.log(`[ProConnect Sync] Synced ${count} custom statuses`)
  return { count, errors }
}

/**
 * Run the full sync with timeout awareness
 */
export async function runFullSync(
  syncType: "full" | "manual" | "webhook" = "full"
): Promise<SyncResult> {
  const startTime = Date.now()
  const supabase = getSupabaseAdmin()
  const errors: string[] = []
  let timedOut = false

  // Create sync log
  const syncLogId = await createSyncLog(supabase, syncType)

  try {
    // 1. Sync clients
    const clientResult = await syncClients(supabase)
    errors.push(...clientResult.errors)

    // Check timeout after clients
    if (Date.now() - startTime > MAX_EXECUTION_MS) {
      timedOut = true
      throw new Error("Timeout after syncing clients")
    }

    // 2. Sync engagements (this is the slow part)
    const engagementResult = await syncEngagements(supabase, startTime)
    errors.push(...engagementResult.errors)
    timedOut = engagementResult.timedOut

    // 3. Sync custom statuses (only if we have time)
    let statusResult = { count: 0, errors: [] as string[] }
    if (!timedOut && Date.now() - startTime < MAX_EXECUTION_MS) {
      statusResult = await syncCustomStatuses(supabase)
      errors.push(...statusResult.errors)
    }

    const success = !timedOut && errors.length === 0

    // Update sync log
    await updateSyncLog(supabase, syncLogId, {
      status: timedOut ? "failed" : success ? "success" : "failed",
      clients_synced: clientResult.count,
      engagements_synced: engagementResult.count,
      custom_statuses_synced: statusResult.count,
      error_message: timedOut
        ? `Timed out after ${Math.round((Date.now() - startTime) / 1000)}s - partial sync completed`
        : success
          ? null
          : `${errors.length} errors occurred`,
      error_details: timedOut
        ? { timedOut: true, errors: errors.slice(0, 20) }
        : success
          ? null
          : { errors: errors.slice(0, 50) },
    })

    return {
      success,
      syncLogId,
      clientsSynced: clientResult.count,
      engagementsSynced: engagementResult.count,
      customStatusesSynced: statusResult.count,
      errors,
      duration: Date.now() - startTime,
      timedOut,
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error"

    await updateSyncLog(supabase, syncLogId, {
      status: "failed",
      error_message: timedOut
        ? `Timed out: ${errorMessage}`
        : errorMessage,
      error_details: { 
        stack: err instanceof Error ? err.stack : null,
        timedOut,
      },
    })

    return {
      success: false,
      syncLogId,
      clientsSynced: 0,
      engagementsSynced: 0,
      customStatusesSynced: 0,
      errors: [errorMessage],
      duration: Date.now() - startTime,
      timedOut,
    }
  }
}

/**
 * Get sync statistics
 */
export async function getSyncStats(): Promise<{
  lastSync: SyncLog | null
  consecutiveFailures: number
  totalClients: number
  totalEngagements: number
}> {
  const supabase = getSupabaseAdmin()

  const [lastSyncResult, clientsResult, engagementsResult] = await Promise.all([
    supabase
      .from("proconnect_sync_logs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(1)
      .single(),
    supabase
      .from("proconnect_clients")
      .select("id", { count: "exact", head: true }),
    supabase
      .from("proconnect_engagements")
      .select("id", { count: "exact", head: true }),
  ])

  const consecutiveFailures = await getConsecutiveFailureCount(supabase)

  return {
    lastSync: lastSyncResult.data as SyncLog | null,
    consecutiveFailures,
    totalClients: clientsResult.count || 0,
    totalEngagements: engagementsResult.count || 0,
  }
}

/**
 * Sync a single client (for webhook updates)
 */
export async function syncSingleClient(
  proconnectClientId: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseAdmin()

  try {
    // Import fetchClient dynamically to avoid circular deps
    const { fetchClient } = await import("./client")
    const response = await fetchClient(proconnectClientId)

    if (!response.ok || !response.data) {
      return { success: false, error: response.error || "Not found" }
    }

    const client = response.data
    const email = extractClientEmail(client)
    const names = extractClientName(client)
    const hubContactId = await matchClientToContact(supabase, email)

    const { error } = await supabase
      .from("proconnect_clients")
      .upsert(
        {
          proconnect_client_id: proconnectClientId,
          email,
          first_name: names.firstName,
          last_name: names.lastName,
          business_name: names.businessName,
          display_name: names.displayName,
          name_for_matching: names.displayName?.toLowerCase(),
          raw_json: client,
          hub_contact_id: hubContactId,
          synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "proconnect_client_id" }
      )

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    }
  }
}

/**
 * Delete a client (for webhook deletes)
 */
export async function deleteClient(
  proconnectClientId: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseAdmin()

  try {
    // Delete engagements first
    await supabase
      .from("proconnect_engagements")
      .delete()
      .eq("proconnect_client_id", proconnectClientId)

    // Delete client
    const { error } = await supabase
      .from("proconnect_clients")
      .delete()
      .eq("proconnect_client_id", proconnectClientId)

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    }
  }
}
