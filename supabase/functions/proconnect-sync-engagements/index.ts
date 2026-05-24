// @ts-nocheck
/**
 * ProConnect Sync Engagements - Supabase Edge Function (Deno Runtime)
 *
 * Pulls tax return engagements from the ProConnect API for a given year and
 * optional client range, then upserts them into proconnect_engagements.
 * Supports batch sync (offset/limit), single-client sync, and dry-run mode.
 *
 * NO AUTH REQUIRED - Supabase gateway handles auth via apikey header.
 * "Verify JWT with legacy secret" should be OFF in function settings.
 *
 * Env vars (set via `supabase secrets set`):
 * - SUPABASE_URL (auto)
 * - SUPABASE_SERVICE_ROLE_KEY (auto)
 * - PROCONNECT_CLIENT_ID
 * - PROCONNECT_CLIENT_SECRET
 */

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2"

// ─────────────────────────────────────────────────────────────────────────────
// CORS Headers
// ─────────────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const PROCONNECT_ENGAGEMENTS_URL =
  "https://engagement.accountant.intuit.com/v2/engagements"
const REFRESH_TOKEN_FUNCTION_URL =
  "https://gylupzxitoebhqjnvzuw.supabase.co/functions/v1/proconnect-refresh-token"

const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000
const PARALLEL_CLIENTS = 3
const MAX_RETRIES = 5
const RETRY_BASE_MS = 600
const WALL_CLOCK_LIMIT_MS = 360_000 // 360s — stop 40s before hard limit

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface StoredToken {
  access_token: string
  refresh_token: string
  expires_at: string
}

interface SyncRequest {
  syncType?: "incremental" | "backfill" | "single_client"
  year: number
  clientOffset?: number
  clientLimit?: number
  dryRun?: boolean
  clientId?: string
}

interface ProConnectClient {
  proconnect_client_id: string
  proconnect_entity_id: string | null
}

interface ProConnectEngagement {
  engagementId: string
  clientId: string
  period: string
  type: string
  name?: string
  state?: string
  status?: string
  workStatus?: string
  customStatus?: string
  assignee?: { profileId?: string; authId?: string }
  createdBy?: { profileId?: string }
  modifiedBy?: { profileId?: string }
  createdDate?: string
  modifiedDate?: string
  taxFiling?: {
    filings?: Array<{
      filingStatuses?: Array<{ status?: string; date?: string }>
    }>
  }
}

interface MappedEngagement {
  engagement_id: string
  proconnect_client_id: string
  tax_year: number
  return_type: string
  form_type: string
  engagement_name: string | null
  engagement_state: string | null
  status: string | null
  work_status: string | null
  user_defined_status_id: string | null
  efile_status: string | null
  assignee_profile_id: string | null
  assignee_auth_id: string | null
  created_by_profile_id: string | null
  modified_by_profile_id: string | null
  proconnect_created_at: string | null
  proconnect_modified_at: string | null
  raw_json: ProConnectEngagement
  synced_at: string
  updated_at: string
}

interface SyncResponse {
  success: boolean
  status: "completed" | "partial" | "failed"
  year: number
  clientOffset: number
  clientLimit: number
  nextClientOffset: number
  clientsProcessed: number
  engagementsFound: number
  engagementsSynced: number
  errors: string[]
  dryRun: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getLatestEfileStatus(eng: ProConnectEngagement): string | null {
  const filings = eng.taxFiling?.filings || []
  let latest: { status?: string; date?: string } | null = null
  let latestDate = new Date(0)

  for (const filing of filings) {
    const statuses = filing.filingStatuses || []
    for (const status of statuses) {
      if (status.date) {
        const date = new Date(status.date)
        if (date > latestDate) {
          latestDate = date
          latest = status
        }
      }
    }
  }

  return latest?.status ?? null
}

function mapEngagementToRow(eng: ProConnectEngagement): MappedEngagement {
  return {
    engagement_id: eng.engagementId,
    proconnect_client_id: eng.clientId,
    tax_year: Number.parseInt(eng.period),
    return_type: eng.type,
    form_type: eng.type,
    engagement_name: eng.name ?? null,
    engagement_state: eng.state ?? null,
    status: eng.status ?? null,
    work_status: eng.workStatus ?? null,
    user_defined_status_id: eng.customStatus ?? null,
    efile_status: getLatestEfileStatus(eng),
    assignee_profile_id: eng.assignee?.profileId ?? null,
    assignee_auth_id: eng.assignee?.authId ?? null,
    created_by_profile_id: eng.createdBy?.profileId ?? null,
    modified_by_profile_id: eng.modifiedBy?.profileId ?? null,
    proconnect_created_at: eng.createdDate ?? null,
    proconnect_modified_at: eng.modifiedDate ?? null,
    raw_json: eng,
    synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries: number = MAX_RETRIES,
): Promise<Response> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, options)

      // Retry on 429 or 5xx
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        const backoff = RETRY_BASE_MS * Math.pow(2, attempt)
        console.log(
          `[v0] Attempt ${attempt + 1}/${retries}: ${res.status} — backoff ${backoff}ms`,
        )
        await sleep(backoff)
        continue
      }

      // Do not retry permanent 4xx except 429
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        return res
      }

      return res
    } catch (e) {
      const backoff = RETRY_BASE_MS * Math.pow(2, attempt)
      console.log(`[v0] Attempt ${attempt + 1}/${retries}: fetch error — ${e}`)
      await sleep(backoff)
    }
  }

  throw new Error(`Failed after ${retries} retries`)
}

async function refreshTokenIfNeeded(
  supabase: SupabaseClient,
  token: StoredToken,
  serviceRoleKey: string,
): Promise<StoredToken> {
  const expiresAt = new Date(token.expires_at)
  const now = new Date()
  const timeUntilExpiry = expiresAt.getTime() - now.getTime()

  if (timeUntilExpiry > TOKEN_EXPIRY_BUFFER_MS) {
    console.log(
      `[v0] Token valid for ${Math.round(timeUntilExpiry / 1000)}s — no refresh needed`,
    )
    return token
  }

  console.log(
    `[v0] Token expires in ${Math.round(timeUntilExpiry / 1000)}s — refreshing`,
  )

  const refreshRes = await fetch(REFRESH_TOKEN_FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  })

  if (!refreshRes.ok) {
    const errorText = await refreshRes.text()
    throw new Error(`Token refresh failed: ${refreshRes.status} — ${errorText}`)
  }

  // Do NOT trust the refresh function response body for the new token —
  // it may not include access_token. Re-read directly from the database
  // so we always have the canonical, freshly-written value.
  console.log(`[v0] Refresh function OK — re-reading token from database`)

  const { data: freshToken, error: readError } = await supabase
    .from("proconnect_oauth_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("is_singleton", true)
    .single()

  if (readError || !freshToken) {
    throw new Error(
      `Failed to re-read token after refresh: ${readError?.message}`,
    )
  }

  if (!freshToken.access_token) {
    throw new Error(
      "Re-read token row has no access_token — refresh may have failed silently",
    )
  }

  console.log("[v0] Re-read refreshed token from database")

  return {
    access_token: freshToken.access_token,
    refresh_token: freshToken.refresh_token,
    expires_at: freshToken.expires_at,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Handler
// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  console.log(`[v0] Engagements sync request: ${req.method} ${req.url}`)

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Only POST allowed" }),
      { status: 405, headers: corsHeaders },
    )
  }

  try {
    // Parse request
    const body: SyncRequest = await req.json()
    const syncType = body.syncType || "backfill"
    const year = body.year
    const clientOffset = body.clientOffset ?? 0
    const clientLimit = body.clientLimit ?? 300
    const dryRun = body.dryRun ?? false
    const clientId = body.clientId

    console.log(
      `[v0] Request: syncType=${syncType}, year=${year}, offset=${clientOffset}, limit=${clientLimit}, dryRun=${dryRun}`,
    )

    if (!year) {
      return new Response(
        JSON.stringify({ error: "year is required" }),
        { status: 400, headers: corsHeaders },
      )
    }

    if (syncType === "single_client" && !clientId) {
      return new Response(
        JSON.stringify({ error: "clientId required for single_client sync" }),
        { status: 400, headers: corsHeaders },
      )
    }

    // Initialize Supabase
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // Get stored token
    console.log(`[v0] Fetching stored OAuth token`)
    const { data: tokenRows, error: tokenError } = await supabase
      .from("proconnect_oauth_tokens")
      .select("access_token, refresh_token, expires_at")
      .eq("is_singleton", true)
      .single()

    if (tokenError || !tokenRows) {
      throw new Error(`Failed to fetch OAuth token: ${tokenError?.message}`)
    }

    let token = tokenRows as StoredToken

    // Refresh token if needed
    token = await refreshTokenIfNeeded(supabase, token, SUPABASE_SERVICE_ROLE_KEY)

    // Get client list
    let clientsToProcess: ProConnectClient[] = []

    if (syncType === "single_client") {
      console.log(`[v0] Fetching single client: ${clientId}`)
      const { data, error } = await supabase
        .from("proconnect_clients")
        .select("proconnect_client_id, proconnect_entity_id")
        .eq("proconnect_client_id", clientId)
        .single()

      if (error || !data) {
        throw new Error(`Client not found: ${clientId}`)
      }

      clientsToProcess = [{
        proconnect_client_id: data.proconnect_client_id,
        proconnect_entity_id: data.proconnect_entity_id ?? null,
      }]
    } else {
      console.log(
        `[v0] Fetching ${clientLimit} clients starting at offset ${clientOffset}`,
      )
      const { data, error } = await supabase
        .from("proconnect_clients")
        .select("proconnect_client_id, proconnect_entity_id")
        .order("proconnect_client_id")
        .range(clientOffset, clientOffset + clientLimit - 1)

      if (error) {
        throw new Error(`Failed to fetch clients: ${error.message}`)
      }

      clientsToProcess = (data || []).map((c: any) => ({
        proconnect_client_id: c.proconnect_client_id,
        proconnect_entity_id: c.proconnect_entity_id ?? null,
      }))
    }

    console.log(`[v0] Processing ${clientsToProcess.length} clients`)

    const startTime = Date.now()
    const mappedEngagements: MappedEngagement[] = []
    const errors: string[] = []
    let processedCount = 0

    // Process clients in parallel batches
    for (let i = 0; i < clientsToProcess.length; i += PARALLEL_CLIENTS) {
      // Wall-clock guard
      if (Date.now() - startTime > WALL_CLOCK_LIMIT_MS) {
        const nextOffset = clientOffset + i
        console.log(
          `[v0] Wall clock limit reached at client index ${i} — stopping for next batch at offset ${nextOffset}`,
        )
        errors.push(
          `Stopped at client ${i}/${clientsToProcess.length} — time limit`,
        )
        break
      }

      const batch = clientsToProcess.slice(
        i,
        Math.min(i + PARALLEL_CLIENTS, clientsToProcess.length),
      )

      const batchPromises = batch.map(async (client) => {
        try {
          // Prefer proconnect_entity_id for the oiiClientId query param —
          // the ProConnect API expects the OII entity ID, not the internal
          // client ID. Fall back to proconnect_client_id if entity_id is null.
          const oiiClientId =
            client.proconnect_entity_id ?? client.proconnect_client_id

          console.log(
            `[v0] Fetching engagements for client ${client.proconnect_client_id} (oiiClientId=${oiiClientId}) year ${year}`,
          )

          const url = new URL(PROCONNECT_ENGAGEMENTS_URL)
          url.searchParams.set("source", "ITO")
          url.searchParams.set("period", String(year))
          url.searchParams.set("oiiClientId", oiiClientId)

          const response = await fetchWithRetry(url.toString(), {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token.access_token}`,
              "Content-Type": "application/json",
            },
          })

          if (!response.ok) {
            const text = await response.text()
            throw new Error(
              `API returned ${response.status}: ${text.slice(0, 200)}`,
            )
          }

          const data = await response.json()

          // [v0] TEMPORARY DEBUG — inspect raw response shape
          console.log(
            `[v0] Raw engagements response for client ${client.proconnect_client_id}:`,
            JSON.stringify(data).slice(0, 3000),
          )

          const engagements: ProConnectEngagement[] =
            Array.isArray(data)
              ? data
              : Array.isArray(data?.engagements)
                ? data.engagements
                : Array.isArray(data?.items)
                  ? data.items
                  : Array.isArray(data?.data)
                    ? data.data
                    : []

          console.log(
            `[v0] Client ${client.proconnect_client_id} (oiiClientId=${oiiClientId}): found ${engagements.length} engagements`,
          )

          return engagements.map(mapEngagementToRow)
        } catch (e) {
          const msg = `Client ${client.proconnect_client_id}: ${e instanceof Error ? e.message : String(e)}`
          console.error(`[v0] ${msg}`)
          errors.push(msg)
          return []
        }
      })

      const batchResults = await Promise.all(batchPromises)
      batchResults.forEach((rows) => {
        mappedEngagements.push(...rows)
      })

      processedCount += batch.length
      console.log(
        `[v0] Batch complete: processed ${processedCount}/${clientsToProcess.length} clients`,
      )
    }

    console.log(
      `[v0] Mapping complete: ${mappedEngagements.length} engagements to sync`,
    )

    // Dry run: return sample data without upsert
    if (dryRun) {
      console.log(`[v0] Dry run mode — not upserting`)
      return new Response(
        JSON.stringify({
          success: true,
          status: "completed",
          year,
          clientOffset,
          clientLimit,
          nextClientOffset: clientOffset + clientsToProcess.length,
          clientsProcessed: clientsToProcess.length,
          engagementsFound: mappedEngagements.length,
          engagementsSynced: 0,
          sampleRows: mappedEngagements.slice(0, 3),
          errors,
          dryRun: true,
        } as SyncResponse),
        { headers: corsHeaders },
      )
    }

    // Upsert in batches
    const UPSERT_BATCH_SIZE = 100
    let upsertedCount = 0

    for (let i = 0; i < mappedEngagements.length; i += UPSERT_BATCH_SIZE) {
      const batch = mappedEngagements.slice(
        i,
        Math.min(i + UPSERT_BATCH_SIZE, mappedEngagements.length),
      )

      console.log(
        `[v0] Upserting batch ${Math.floor(i / UPSERT_BATCH_SIZE) + 1} (${batch.length} rows)`,
      )

      const { error: upsertError } = await supabase
        .from("proconnect_engagements")
        .upsert(batch, {
          onConflict: "proconnect_client_id,tax_year,return_type",
        })

      if (upsertError) {
        const msg = `Upsert error: ${upsertError.message}`
        console.error(`[v0] ${msg}`)
        errors.push(msg)
      } else {
        upsertedCount += batch.length
      }
    }

    const success = errors.length === 0
    const wasStopped = Date.now() - startTime > WALL_CLOCK_LIMIT_MS
    const status = wasStopped ? "partial" : "completed"
    const nextClientOffset = wasStopped
      ? clientOffset + processedCount
      : clientOffset + clientsToProcess.length

    console.log(
      `[v0] Sync ${status}: ${upsertedCount}/${mappedEngagements.length} upserted`,
    )

    return new Response(
      JSON.stringify({
        success,
        status,
        year,
        clientOffset,
        clientLimit,
        nextClientOffset,
        clientsProcessed: processedCount,
        engagementsFound: mappedEngagements.length,
        engagementsSynced: upsertedCount,
        errors,
        dryRun: false,
      } as SyncResponse),
      { headers: corsHeaders },
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[v0] Fatal error: ${msg}`)

    return new Response(
      JSON.stringify({
        success: false,
        status: "failed",
        error: msg,
      }),
      { status: 500, headers: corsHeaders },
    )
  }
})
