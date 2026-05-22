// @ts-nocheck
/**
 * ProConnect Sync - Supabase Edge Function (Deno Runtime)
 *
 * Runs a complete sync of ProConnect clients, engagements, and custom statuses.
 * No timeout pressure - Supabase Edge Functions support up to 400 seconds.
 *
 * No resume logic. No partial states. Just runs to completion.
 *
 * Triggered by:
 * - Vercel cron at /api/cron/proconnect-sync (which calls this)
 * - Manual POST from Hub UI
 *
 * Auth: Bearer SUPABASE_SERVICE_ROLE_KEY (or function-specific secret)
 *
 * Env vars (set via `supabase secrets set`):
 * - PROCONNECT_CLIENT_ID
 * - PROCONNECT_CLIENT_SECRET
 * - PROCONNECT_REFRESH_TOKEN
 * - PROCONNECT_REALM_ID
 * - SUPABASE_URL (auto)
 * - SUPABASE_SERVICE_ROLE_KEY (auto)
 */

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2"

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const PROCONNECT_CLIENT_ID = Deno.env.get("PROCONNECT_CLIENT_ID")!
const PROCONNECT_CLIENT_SECRET = Deno.env.get("PROCONNECT_CLIENT_SECRET")!
const PROCONNECT_REFRESH_TOKEN = Deno.env.get("PROCONNECT_REFRESH_TOKEN")!
const PROCONNECT_REALM_ID = Deno.env.get("PROCONNECT_REALM_ID")!
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"
const CLIENT_SERVICE_URL = "https://client.accountant.intuit.com"
const ENGAGEMENT_SERVICE_URL = "https://engagement.accountant.intuit.com"

const TAX_YEARS = [2023, 2024, 2025]
const PARALLEL_CLIENTS = 5 // Higher than Vercel since no timeout pressure
const REFRESH_BUFFER_SECONDS = 300

// ─────────────────────────────────────────────────────────────────────────────
// Supabase Admin
// ─────────────────────────────────────────────────────────────────────────────

function getSupabaseAdmin(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// OAuth Token Management
// ─────────────────────────────────────────────────────────────────────────────

interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
}

async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const credentials = btoa(`${PROCONNECT_CLIENT_ID}:${PROCONNECT_CLIENT_SECRET}`)

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Token refresh failed: ${response.status} - ${errorText}`)
  }

  return response.json()
}

async function getAccessToken(supabase: SupabaseClient): Promise<string> {
  // Try to fetch stored token
  const { data: stored } = await supabase
    .from("proconnect_oauth_tokens")
    .select("*")
    .limit(1)
    .single()

  // Check if cached token is still valid
  if (stored && stored.expires_at) {
    const expiryTime = new Date(stored.expires_at).getTime()
    const bufferTime = Date.now() + REFRESH_BUFFER_SECONDS * 1000
    if (bufferTime < expiryTime) {
      return stored.access_token
    }
  }

  // Refresh
  const refreshToken = stored?.refresh_token || PROCONNECT_REFRESH_TOKEN
  if (!refreshToken) {
    throw new Error("No refresh token available")
  }

  console.log("[Edge] Refreshing access token...")
  const newTokens = await refreshAccessToken(refreshToken)

  // Store
  const expiresAt = new Date(Date.now() + newTokens.expires_in * 1000).toISOString()
  const payload = {
    is_singleton: true,
    access_token: newTokens.access_token,
    refresh_token: newTokens.refresh_token,
    token_type: newTokens.token_type,
    expires_at: expiresAt,
    scope: "com.intuit.proconnect.taxreturns",
    realm_id: PROCONNECT_REALM_ID,
    updated_at: new Date().toISOString(),
  }

  // Try insert, fall back to update
  const { error: insertError } = await supabase
    .from("proconnect_oauth_tokens")
    .insert(payload)

  if (insertError && insertError.code === "23505") {
    await supabase
      .from("proconnect_oauth_tokens")
      .update({
        access_token: newTokens.access_token,
        refresh_token: newTokens.refresh_token,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("is_singleton", true)
  } else if (insertError) {
    throw new Error(`Failed to store token: ${insertError.message}`)
  }

  return newTokens.access_token
}

// ─────────────────────────────────────────────────────────────────────────────
// ProConnect API
// ─────────────────────────────────────────────────────────────────────────────

async function pcFetch(
  accessToken: string,
  url: string
): Promise<{ ok: boolean; status: number; data: any; error: string | null }> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        intuit_product: "ITO",
        intuit_realmid: PROCONNECT_REALM_ID,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      return {
        ok: false,
        status: response.status,
        data: null,
        error: `${response.status} ${response.statusText}: ${errorText.slice(0, 200)}`,
      }
    }

    const data = await response.json()
    return { ok: true, status: response.status, data, error: null }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: err instanceof Error ? err.message : "Unknown error",
    }
  }
}

async function fetchClients(accessToken: string) {
  const result = await pcFetch(accessToken, `${CLIENT_SERVICE_URL}/v1/clients`)
  if (!result.ok || !result.data) return result
  const clients = result.data.clients || result.data
  return { ...result, data: Array.isArray(clients) ? clients : [clients] }
}

async function fetchEngagements(accessToken: string, oiiClientId: string, taxYear: number) {
  const url = `${ENGAGEMENT_SERVICE_URL}/v2/engagements?source=ITO&period=${taxYear}&oiiClientId=${oiiClientId}`
  const result = await pcFetch(accessToken, url)
  if (!result.ok || !result.data) return result
  const engagements = result.data.engagements || result.data
  return { ...result, data: Array.isArray(engagements) ? engagements : [engagements] }
}

async function fetchCustomStatuses(accessToken: string) {
  const result = await pcFetch(
    accessToken,
    `${ENGAGEMENT_SERVICE_URL}/v1/custom-status?source=ITO`
  )
  if (!result.ok || !result.data) return result
  const statuses = result.data.statuses || result.data
  return { ...result, data: Array.isArray(statuses) ? statuses : [statuses] }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync Functions
// ─────────────────────────────────────────────────────────────────────────────

async function syncClients(
  supabase: SupabaseClient,
  accessToken: string
): Promise<{ count: number; errors: string[] }> {
  console.log("[Edge] Fetching clients...")
  const response = await fetchClients(accessToken)

  if (!response.ok || !response.data) {
    return { count: 0, errors: [response.error || "Failed to fetch clients"] }
  }

  const clients = response.data
  console.log(`[Edge] Got ${clients.length} clients`)

  let count = 0
  const errors: string[] = []
  const now = new Date().toISOString()

  for (const client of clients) {
    const c = client as Record<string, any>
    const clientId = c.id || c.clientId || c.oiiClientId
    if (!clientId) continue

    // Extract email
    let email: string | null = null
    if (c.person?.emailAddresses && Array.isArray(c.person.emailAddresses)) {
      const primary = c.person.emailAddresses.find(
        (e: any) => e?.properties?.isPrimary === "true"
      )
      email = (primary || c.person.emailAddresses[0])?.address || null
    }

    // Extract names
    let firstName: string | null = null
    let lastName: string | null = null
    if (c.person?.names && Array.isArray(c.person.names) && c.person.names.length > 0) {
      firstName = c.person.names[0].firstName || null
      lastName = c.person.names[0].lastName || null
    }
    const businessName = c.businessName || null
    const displayName = businessName || [firstName, lastName].filter(Boolean).join(" ") || c.name || null

    const { error } = await supabase.from("proconnect_clients").upsert(
      {
        proconnect_client_id: clientId,
        email,
        first_name: firstName,
        last_name: lastName,
        business_name: businessName,
        display_name: displayName,
        raw_json: client,
        synced_at: now,
        updated_at: now,
      },
      { onConflict: "proconnect_client_id" }
    )

    if (error) {
      errors.push(`Client ${clientId}: ${error.message}`)
    } else {
      count++
    }
  }

  console.log(`[Edge] Synced ${count} clients`)
  return { count, errors }
}

async function syncClientEngagements(
  supabase: SupabaseClient,
  accessToken: string,
  clientId: string
): Promise<{ count: number; errors: string[] }> {
  let count = 0
  const errors: string[] = []
  const now = new Date().toISOString()

  for (const year of TAX_YEARS) {
    const response = await fetchEngagements(accessToken, clientId, year)

    if (!response.ok) {
      if (response.status !== 404) {
        errors.push(`Engagements ${clientId}/${year}: ${response.error}`)
      }
      continue
    }

    if (!response.data || response.data.length === 0) continue

    for (const engagement of response.data) {
      const eng = engagement as Record<string, any>
      const engagementId = eng.id || eng.engagementId || `${clientId}-${year}`
      const formType = eng.type || null

      // Hoist nested raw_json fields into first-class columns so the
      // /tax dashboard, enriched view, and ALFRED can query without
      // unwrapping JSON. raw_json is still preserved for forensics.
      const assigneeProfileId = eng.assignee?.profileId ?? null
      const assigneeAuthId = eng.assignee?.authId ?? null
      const createdByProfileId = eng.createdBy?.profileId ?? null
      const modifiedByProfileId = eng.modifiedBy?.profileId ?? null
      const userDefinedStatusId = eng.userDefinedStatus ?? null
      const engagementName = eng.name ?? null
      const engagementState = eng.state ?? null
      const proconnectCreatedAt = eng.createdDate || null
      const proconnectModifiedAt = eng.modifiedDate || null

      const { error } = await supabase.from("proconnect_engagements").upsert(
        {
          engagement_id: engagementId,
          proconnect_client_id: clientId,
          tax_year: year,
          return_type: formType,
          form_type: formType,
          status: eng.status || null,
          efile_status: eng.efileStatus || null,
          work_status: eng.workStatus || null,
          assignee_profile_id: assigneeProfileId,
          assignee_auth_id: assigneeAuthId,
          created_by_profile_id: createdByProfileId,
          modified_by_profile_id: modifiedByProfileId,
          user_defined_status_id: userDefinedStatusId,
          engagement_name: engagementName,
          engagement_state: engagementState,
          proconnect_created_at: proconnectCreatedAt,
          proconnect_modified_at: proconnectModifiedAt,
          raw_json: engagement,
          synced_at: now,
          updated_at: now,
        },
        { onConflict: "proconnect_client_id,tax_year,return_type" }
      )

      if (error) {
        errors.push(`Engagement ${engagementId}: ${error.message}`)
      } else {
        count++
      }
    }
  }

  return { count, errors }
}

async function syncEngagements(
  supabase: SupabaseClient,
  accessToken: string
): Promise<{ count: number; errors: string[]; totalClients: number }> {
  console.log("[Edge] Fetching client list for engagement sync...")

  const { data: clients, error } = await supabase
    .from("proconnect_clients")
    .select("proconnect_client_id")
    .order("proconnect_client_id", { ascending: true })

  if (error || !clients) {
    return {
      count: 0,
      errors: [error?.message || "Failed to get clients"],
      totalClients: 0,
    }
  }

  console.log(`[Edge] Processing engagements for ${clients.length} clients (parallel ${PARALLEL_CLIENTS})`)

  let count = 0
  const errors: string[] = []
  const startTime = Date.now()

  // Process in parallel batches - no timeout pressure here
  for (let i = 0; i < clients.length; i += PARALLEL_CLIENTS) {
    const batch = clients
      .slice(i, i + PARALLEL_CLIENTS)
      .map((c) => c.proconnect_client_id)
      .filter(Boolean) as string[]

    const results = await Promise.all(
      batch.map((id) => syncClientEngagements(supabase, accessToken, id))
    )

    for (const result of results) {
      count += result.count
      errors.push(...result.errors)
    }

    if ((i + PARALLEL_CLIENTS) % 30 === 0 || i + PARALLEL_CLIENTS >= clients.length) {
      const elapsed = Math.round((Date.now() - startTime) / 1000)
      console.log(
        `[Edge] Progress: ${Math.min(i + PARALLEL_CLIENTS, clients.length)}/${clients.length} clients, ${count} engagements, ${elapsed}s elapsed`
      )
    }
  }

  console.log(`[Edge] Synced ${count} engagements total`)
  return { count, errors, totalClients: clients.length }
}

async function syncCustomStatuses(
  supabase: SupabaseClient,
  accessToken: string
): Promise<{ count: number; errors: string[] }> {
  console.log("[Edge] Fetching custom statuses...")
  const response = await fetchCustomStatuses(accessToken)

  if (!response.ok || !response.data) {
    return { count: 0, errors: [response.error || "Failed to fetch statuses"] }
  }

  const statuses = response.data
  let count = 0
  const errors: string[] = []
  const now = new Date().toISOString()

  for (const status of statuses) {
    const s = status as Record<string, any>
    const statusId = s.id || s.statusId
    if (!statusId) continue

    const { error } = await supabase.from("proconnect_custom_statuses").upsert(
      {
        custom_status_id: statusId,
        name: s.name || null,
        category: s.category || null,
        raw_json: status,
        synced_at: now,
        updated_at: now,
      },
      { onConflict: "custom_status_id" }
    )

    if (error) {
      errors.push(`Status ${statusId}: ${error.message}`)
    } else {
      count++
    }
  }

  console.log(`[Edge] Synced ${count} custom statuses`)
  return { count, errors }
}

// ───────────────��─────────────────────────────────────────────────────────────
// Sync Logging
// ─────────────────────────────────────────────────────────────────────────────

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

  if (error || !data) {
    throw new Error(`Failed to create sync log: ${error?.message}`)
  }

  return data.id
}

async function updateSyncLog(
  supabase: SupabaseClient,
  syncLogId: string,
  updates: Record<string, any>
): Promise<void> {
  await supabase
    .from("proconnect_sync_logs")
    .update({ ...updates, completed_at: new Date().toISOString() })
    .eq("id", syncLogId)
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Handler
// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Verify auth - accept service role key OR a custom bearer token
  const authHeader = req.headers.get("authorization")
  const expectedAuth = `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`

  if (authHeader !== expectedAuth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })
  }

  const startTime = Date.now()
  const supabase = getSupabaseAdmin()

  console.log("[Edge] ProConnect sync starting...")

  let syncLogId: string | null = null

  try {
    // Get sync type from request
    let syncType = "full"
    if (req.method === "POST") {
      try {
        const body = await req.json()
        syncType = body.syncType || "full"
      } catch {
        // No body, use default
      }
    }

    // 1. Create sync log
    syncLogId = await createSyncLog(supabase, syncType)

    // 2. Get access token
    const accessToken = await getAccessToken(supabase)

    // 3. Sync clients
    const clientResult = await syncClients(supabase, accessToken)

    // 4. Sync engagements (no timeout pressure - run all clients in parallel batches)
    const engagementResult = await syncEngagements(supabase, accessToken)

    // 5. Sync custom statuses
    const statusResult = await syncCustomStatuses(supabase, accessToken)

    const errors = [...clientResult.errors, ...engagementResult.errors, ...statusResult.errors]
    const success = errors.length === 0
    const duration = Date.now() - startTime

    // Update sync log
    await updateSyncLog(supabase, syncLogId, {
      status: success ? "success" : "failed",
      clients_synced: clientResult.count,
      engagements_synced: engagementResult.count,
      custom_statuses_synced: statusResult.count,
      last_client_index: 0, // Always 0 since we always finish
      error_message: success ? null : `${errors.length} errors occurred`,
      error_details: success ? null : { errors: errors.slice(0, 50) },
    })

    console.log(`[Edge] Sync complete in ${Math.round(duration / 1000)}s`)

    return new Response(
      JSON.stringify({
        success,
        syncLogId,
        clientsSynced: clientResult.count,
        engagementsSynced: engagementResult.count,
        customStatusesSynced: statusResult.count,
        totalClients: engagementResult.totalClients,
        errorCount: errors.length,
        errors: errors.slice(0, 20),
        duration,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    )
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error"
    console.error("[Edge] Fatal error:", errorMessage)

    if (syncLogId) {
      await updateSyncLog(supabase, syncLogId, {
        status: "failed",
        error_message: errorMessage,
        error_details: { stack: err instanceof Error ? err.stack : null },
      })
    }

    return new Response(
      JSON.stringify({
        success: false,
        syncLogId,
        error: errorMessage,
        duration: Date.now() - startTime,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    )
  }
})
