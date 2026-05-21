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
// Leave 20s buffer for cleanup and slow API calls
const MAX_EXECUTION_MS = 40_000

interface SyncResult {
  success: boolean
  syncLogId: string
  clientsSynced: number
  engagementsSynced: number
  customStatusesSynced: number
  errors: string[]
  duration: number
  timedOut?: boolean
  partial?: boolean
  lastClientIndex?: number
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
  last_client_index: number
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
 * Get the resume index from the most recent partial sync.
 * Returns 0 if the last sync was complete or successful.
 */
async function getResumeIndex(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase
    .from("proconnect_sync_logs")
    .select("status, last_client_index")
    .order("started_at", { ascending: false })
    .limit(1)
    .single()

  if (error || !data) return 0

  // Only resume if the last run was partial
  if (data.status === "partial" && typeof data.last_client_index === "number") {
    return data.last_client_index
  }

  return 0
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
  const fnStart = Date.now()
  console.log("[v0] syncClients start")

  console.log("[v0] syncClients - calling fetchClients API", Date.now() - fnStart, "ms")
  const response = await fetchClients()
  console.log("[v0] syncClients - fetchClients API done", Date.now() - fnStart, "ms")

  if (!response.ok || !response.data) {
    return { count: 0, errors: [response.error || "Failed to fetch clients"] }
  }

  const clients = response.data
  console.log(`[v0] syncClients - got ${clients.length} clients`, Date.now() - fnStart, "ms")

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
 * Supports resumable sync - starts from startIndex and tracks progress.
 * Returns the last processed index so the next run can resume.
 */
async function syncEngagements(
  supabase: SupabaseClient,
  startTime: number,
  startIndex: number = 0
): Promise<{
  count: number
  errors: string[]
  timedOut: boolean
  lastClientIndex: number
  totalClients: number
}> {
  console.log(`[ProConnect Sync] Fetching engagements (starting from client index ${startIndex})...`)

  // Get all client IDs
  const { data: clients, error: clientError } = await supabase
    .from("proconnect_clients")
    .select("proconnect_client_id")
    .order("proconnect_client_id", { ascending: true }) // Consistent ordering for resume

  if (clientError || !clients) {
    return {
      count: 0,
      errors: [clientError?.message || "Failed to get client IDs"],
      timedOut: false,
      lastClientIndex: startIndex,
      totalClients: 0,
    }
  }

  let count = 0
  const errors: string[] = []
  let timedOut = false
  let lastClientIndex = startIndex

  // Process clients starting from startIndex
  for (let i = startIndex; i < clients.length; i++) {
    // Check timeout before processing each client
    const elapsed = Date.now() - startTime
    if (elapsed > MAX_EXECUTION_MS) {
      console.log(
        `[ProConnect Sync] Timeout approaching after ${i - startIndex} clients (index ${i}), stopping gracefully`
      )
      timedOut = true
      lastClientIndex = i // Save where we stopped
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

          // Extract form type - the API returns it as "type" (e.g., "1040", "1065", "1120", "1120S", "990")
          // This is the actual form type, not a code that needs mapping
          const formType = (eng.type as string) || null
          const returnType = formType // Store same value in return_type for backwards compat

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

    // Update last processed index after each client
    lastClientIndex = i + 1

    // Log progress every batch
    if ((i - startIndex + 1) % CLIENT_BATCH_SIZE === 0) {
      console.log(
        `[ProConnect Sync] Progress: ${i + 1}/${clients.length} clients, ${count} engagements this run`
      )
    }
  }

  // If we processed all clients, reset to 0
  if (lastClientIndex >= clients.length) {
    lastClientIndex = 0
  }

  console.log(
    `[ProConnect Sync] Synced ${count} engagements${timedOut ? ` (stopped at index ${lastClientIndex})` : " (complete)"}`
  )
  return { count, errors, timedOut, lastClientIndex, totalClients: clients.length }
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
 * Run the full sync with timeout awareness and resumable progress.
 * If a previous run was partial, this will resume from where it left off.
 */
export async function runFullSync(
  syncType: "full" | "manual" | "webhook" = "full"
): Promise<SyncResult> {
  const startTime = Date.now()
  console.log("[v0] Sync started at", startTime)

  const supabase = getSupabaseAdmin()
  const errors: string[] = []
  let timedOut = false

  // Check if we should resume from a previous partial run
  console.log("[v0] Step 1 start - getResumeIndex", Date.now() - startTime, "ms elapsed")
  const resumeIndex = await getResumeIndex(supabase)
  console.log("[v0] Step 1 done - getResumeIndex", Date.now() - startTime, "ms elapsed, resumeIndex:", resumeIndex)

  const isResuming = resumeIndex > 0

  if (isResuming) {
    console.log(`[ProConnect Sync] Resuming from client index ${resumeIndex}`)
  }

  // Create sync log
  console.log("[v0] Step 2 start - createSyncLog", Date.now() - startTime, "ms elapsed")
  const syncLogId = await createSyncLog(supabase, syncType)
  console.log("[v0] Step 2 done - createSyncLog", Date.now() - startTime, "ms elapsed")

  try {
    // 1. Sync clients (only on fresh runs, not resumes)
    let clientResult = { count: 0, errors: [] as string[] }
    if (!isResuming) {
      console.log("[v0] Step 3 start - syncClients", Date.now() - startTime, "ms elapsed")
      clientResult = await syncClients(supabase)
      console.log("[v0] Step 3 done - syncClients", Date.now() - startTime, "ms elapsed, count:", clientResult.count)
      errors.push(...clientResult.errors)

      // Check timeout after clients
      if (Date.now() - startTime > MAX_EXECUTION_MS) {
        timedOut = true
        throw new Error("Timeout after syncing clients")
      }
    }

    // 2. Sync engagements (this is the slow part - resumable)
    console.log("[v0] Step 4 start - syncEngagements", Date.now() - startTime, "ms elapsed")
    const engagementResult = await syncEngagements(supabase, startTime, resumeIndex)
    console.log("[v0] Step 4 done - syncEngagements", Date.now() - startTime, "ms elapsed, count:", engagementResult.count)
    errors.push(...engagementResult.errors)
    timedOut = engagementResult.timedOut

    // Determine if this was a partial or complete run
    const isPartial = timedOut && engagementResult.lastClientIndex > 0
    const isComplete = engagementResult.lastClientIndex === 0 && !timedOut

    // 3. Sync custom statuses (only if we completed all clients and have time)
    let statusResult = { count: 0, errors: [] as string[] }
    if (isComplete && Date.now() - startTime < MAX_EXECUTION_MS) {
      statusResult = await syncCustomStatuses(supabase)
      errors.push(...statusResult.errors)
    }

    const success = isComplete && errors.length === 0

    // Determine status
    let status: string
    if (isPartial) {
      status = "partial"
    } else if (success) {
      status = "success"
    } else {
      status = "failed"
    }

    // Update sync log
    await updateSyncLog(supabase, syncLogId, {
      status,
      clients_synced: clientResult.count,
      engagements_synced: engagementResult.count,
      custom_statuses_synced: statusResult.count,
      last_client_index: engagementResult.lastClientIndex,
      error_message: isPartial
        ? `Partial sync: processed ${engagementResult.lastClientIndex}/${engagementResult.totalClients} clients in ${Math.round((Date.now() - startTime) / 1000)}s`
        : success
          ? null
          : `${errors.length} errors occurred`,
      error_details: isPartial
        ? {
            partial: true,
            lastClientIndex: engagementResult.lastClientIndex,
            totalClients: engagementResult.totalClients,
            errors: errors.slice(0, 20),
          }
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
      partial: isPartial,
      lastClientIndex: engagementResult.lastClientIndex,
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error"

    // Check if this was a timeout - treat as partial, not failed
    const isTimeoutError =
      timedOut ||
      errorMessage.toLowerCase().includes("timeout") ||
      errorMessage.toLowerCase().includes("timed out")

    if (isTimeoutError) {
      // Timeout should be partial, not failed - so it doesn't trigger 3-strike alerts
      await updateSyncLog(supabase, syncLogId, {
        status: "partial",
        last_client_index: resumeIndex > 0 ? resumeIndex : 1, // Save progress for resume
        error_message: `Partial sync: timed out after ${Math.round((Date.now() - startTime) / 1000)}s - will resume on next run`,
        error_details: {
          partial: true,
          timedOut: true,
          resumeIndex,
          stack: err instanceof Error ? err.stack : null,
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
        timedOut: true,
        partial: true,
        lastClientIndex: resumeIndex,
      }
    }

    // Actual failure (not timeout)
    await updateSyncLog(supabase, syncLogId, {
      status: "failed",
      last_client_index: resumeIndex, // Preserve resume point on failure
      error_message: errorMessage,
      error_details: { 
        stack: err instanceof Error ? err.stack : null,
        timedOut: false,
        resumeIndex,
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
      timedOut: false,
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
