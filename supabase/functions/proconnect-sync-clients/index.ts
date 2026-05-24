// @ts-nocheck
/**
 * ProConnect Sync Clients - Supabase Edge Function (Deno Runtime)
 *
 * Pulls all clients from the ProConnect API and upserts them into the
 * proconnect_clients table. Logs the run in proconnect_sync_logs.
 *
 * NO AUTH REQUIRED - Supabase gateway handles auth via apikey header.
 * "Verify JWT with legacy secret" should be OFF in function settings.
 *
 * Env vars (set via `supabase secrets set`):
 * - SUPABASE_URL (auto)
 * - SUPABASE_SERVICE_ROLE_KEY (auto)
 */

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2"

// ─────────────────────────────────────────────────────────────────────────────
// CORS Headers
// ─────────────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const PROCONNECT_CLIENTS_URL = "https://client.accountant.intuit.com/v1/clients"
const REFRESH_TOKEN_FUNCTION_URL =
  "https://gylupzxitoebhqjnvzuw.supabase.co/functions/v1/proconnect-refresh-token"

// Token is considered expired if it expires within 5 minutes
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface StoredToken {
  id: string
  access_token: string
  refresh_token: string
  expires_at: string
}

interface ProConnectClient {
  oiiClientId?: string
  id?: { value?: string }
  clientState?: string
  person?: {
    names?: Array<{ firstName?: string; lastName?: string }>
    taxId?: string
  }
  organization?: {
    names?: Array<{ name?: string }>
    taxId?: string
  }
  emailAddresses?: Array<{
    address?: string
    properties?: { isPrimary?: string }
  }>
  phoneNumbers?: Array<{
    number?: string
    properties?: { isPrimary?: string }
  }>
  physicalAddresses?: Array<{
    city?: string
    stateOrProvince?: string
    postalCode?: string
    properties?: { isPrimary?: string }
  }>
}

interface SyncLogRow {
  id: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Extract primary item from array with isPrimary flag
// ─────────────────────────────────────────────────────────────────────────────

function getPrimary<T extends { properties?: { isPrimary?: string } }>(
  items: T[] | undefined
): T | undefined {
  if (!items || items.length === 0) return undefined
  const primary = items.find((i) => i.properties?.isPrimary === "true")
  return primary || items[0]
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Extract client name following existing convention
// ─────────────────────────────────────────────────────────────────────────────

function extractClientName(client: ProConnectClient): {
  firstName: string | null
  lastName: string | null
  businessName: string | null
  displayName: string | null
} {
  let firstName: string | null = null
  let lastName: string | null = null
  let businessName: string | null = null

  // Person names
  if (client.person?.names && client.person.names.length > 0) {
    const name = client.person.names[0]
    firstName = name.firstName || null
    lastName = name.lastName || null
  }

  // Organization name
  if (client.organization?.names && client.organization.names.length > 0) {
    businessName = client.organization.names[0].name || null
  }

  // Build display name: business name first, else "FirstName LastName"
  const displayName =
    businessName || [firstName, lastName].filter(Boolean).join(" ") || null

  return { firstName, lastName, businessName, displayName }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Map ProConnect client to proconnect_clients row
// ─────────────────────────────────────────────────────────────────────────────

function mapClientToRow(client: ProConnectClient): Record<string, unknown> {
  const { firstName, lastName, businessName, displayName } =
    extractClientName(client)

  const primaryEmail = getPrimary(client.emailAddresses)
  const primaryPhone = getPrimary(client.phoneNumbers)
  const primaryAddress = getPrimary(client.physicalAddresses)

  // Determine client type
  const clientType = client.person
    ? "individual"
    : client.organization
      ? "business"
      : null

  // Tax ID from person or organization
  const taxId = client.person?.taxId || client.organization?.taxId || null

  return {
    proconnect_client_id: client.oiiClientId || null,
    top_level_entity_id: client.id?.value || null,
    client_type: clientType,
    client_state: client.clientState || null,
    first_name: firstName,
    last_name: lastName,
    business_name: businessName,
    display_name: displayName,
    email: primaryEmail?.address || null,
    phone: primaryPhone?.number || null,
    city: primaryAddress?.city || null,
    state: primaryAddress?.stateOrProvince || null,
    zip: primaryAddress?.postalCode || null,
    tax_id: taxId,
    raw_json: client,
    synced_at: new Date().toISOString(),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Handler
// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const startTime = Date.now()
  console.log("[v0] ========== PROCONNECT-SYNC-CLIENTS INVOKED ==========")
  console.log("[v0] Method:", req.method)

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  let supabase: SupabaseClient
  let syncLogId: string | null = null

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // Step 0: Read environment variables and create Supabase client
    // ─────────────────────────────────────────────────────────────────────────
    console.log("[v0] Step 0: Reading environment variables...")

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error("[v0] ERROR: Supabase env vars missing")
      return new Response(
        JSON.stringify({
          success: false,
          error: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing",
        }),
        { status: 500, headers: corsHeaders }
      )
    }

    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    })

    console.log("[v0] Supabase client created")

    // ─────────────────────────────────────────────────────────────────────────
    // Step 1: Start sync log entry
    // ─────────────────────────────────────────────────────────────────────────
    console.log("[v0] Step 1: Creating sync log entry...")

    const { data: logRow, error: logInsertError } = await supabase
      .from("proconnect_sync_logs")
      .insert({
        sync_type: "clients",
        status: "running",
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single()

    if (logInsertError) {
      console.error("[v0] Warning: Failed to create sync log:", logInsertError.message)
      // Continue anyway - logging shouldn't block the sync
    } else {
      syncLogId = (logRow as SyncLogRow).id
      console.log("[v0] Sync log created with ID:", syncLogId)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step 2: Get valid access token
    // ─────────────────────────────────────────────────────────────────────────
    console.log("[v0] Step 2: Fetching OAuth token...")

    const { data: storedToken, error: tokenFetchError } = await supabase
      .from("proconnect_oauth_tokens")
      .select("id, access_token, refresh_token, expires_at")
      .eq("is_singleton", true)
      .single()

    if (tokenFetchError || !storedToken) {
      const errorMsg = `Failed to fetch OAuth token: ${tokenFetchError?.message || "No singleton row found"}`
      console.error("[v0] ERROR:", errorMsg)
      await updateSyncLog(supabase, syncLogId, "failed", 0, errorMsg)
      return new Response(
        JSON.stringify({ success: false, error: errorMsg }),
        { status: 500, headers: corsHeaders }
      )
    }

    const token = storedToken as StoredToken
    console.log("[v0] Token found, expires_at:", token.expires_at)

    // Check if token is expired or will expire within 5 minutes
    const expiresAt = new Date(token.expires_at).getTime()
    const isExpiringSoon = expiresAt - Date.now() < TOKEN_EXPIRY_BUFFER_MS

    let accessToken = token.access_token

    if (isExpiringSoon) {
      console.log("[v0] Token is expired or expiring soon, refreshing...")

      const refreshResponse = await fetch(REFRESH_TOKEN_FUNCTION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      })

      if (!refreshResponse.ok) {
        const refreshText = await refreshResponse.text()
        const errorMsg = `Token refresh failed: ${refreshResponse.status} - ${refreshText}`
        console.error("[v0] ERROR:", errorMsg)
        await updateSyncLog(supabase, syncLogId, "failed", 0, errorMsg)
        return new Response(
          JSON.stringify({ success: false, error: errorMsg }),
          { status: 502, headers: corsHeaders }
        )
      }

      console.log("[v0] Token refreshed, re-fetching from database...")

      // Re-fetch the updated token
      const { data: refreshedToken, error: refetchError } = await supabase
        .from("proconnect_oauth_tokens")
        .select("access_token")
        .eq("is_singleton", true)
        .single()

      if (refetchError || !refreshedToken) {
        const errorMsg = `Failed to re-fetch refreshed token: ${refetchError?.message}`
        console.error("[v0] ERROR:", errorMsg)
        await updateSyncLog(supabase, syncLogId, "failed", 0, errorMsg)
        return new Response(
          JSON.stringify({ success: false, error: errorMsg }),
          { status: 500, headers: corsHeaders }
        )
      }

      accessToken = (refreshedToken as { access_token: string }).access_token
      console.log("[v0] Using refreshed token")
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step 3: Call ProConnect API to fetch all clients
    // ─────────────────────────────────────────────────────────────────────────
    console.log("[v0] Step 3: Calling ProConnect API...")
    console.log("[v0] URL:", PROCONNECT_CLIENTS_URL)

    const apiResponse = await fetch(PROCONNECT_CLIENTS_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    })

    console.log("[v0] API response status:", apiResponse.status)

    if (!apiResponse.ok) {
      const apiText = await apiResponse.text()
      const errorMsg = `ProConnect API failed: ${apiResponse.status} - ${apiText.substring(0, 200)}`
      console.error("[v0] ERROR:", errorMsg)
      await updateSyncLog(supabase, syncLogId, "failed", 0, errorMsg)
      return new Response(
        JSON.stringify({ success: false, error: errorMsg }),
        { status: 502, headers: corsHeaders }
      )
    }

    const clients: ProConnectClient[] = await apiResponse.json()
    console.log("[v0] Fetched", clients.length, "clients from ProConnect")

    // ─────────────────────────────────────────────────────────────────────────
    // Step 4: Map clients to rows
    // ─────────────────────────────────────────────────────────────────────────
    console.log("[v0] Step 4: Mapping clients to database rows...")

    const rows = clients
      .map((client) => {
        try {
          return mapClientToRow(client)
        } catch (err) {
          console.error(
            "[v0] Warning: Failed to map client:",
            client.oiiClientId,
            err
          )
          return null
        }
      })
      .filter((row): row is Record<string, unknown> => row !== null)

    console.log("[v0] Mapped", rows.length, "rows successfully")

    // Filter out rows without proconnect_client_id (the upsert key)
    const validRows = rows.filter((row) => row.proconnect_client_id)
    console.log("[v0] Valid rows with proconnect_client_id:", validRows.length)

    // ─────────────────────────────────────────────────────────────────────────
    // Step 5: Upsert all rows into proconnect_clients
    // ─────────────────────────────────────────────────────────────────────────
    console.log("[v0] Step 5: Upserting rows to proconnect_clients...")

    let syncedCount = 0
    let errorCount = 0
    const errors: Array<{ client_id: string; error: string }> = []

    // Upsert in batches of 100 to avoid payload limits
    const BATCH_SIZE = 100
    for (let i = 0; i < validRows.length; i += BATCH_SIZE) {
      const batch = validRows.slice(i, i + BATCH_SIZE)
      console.log(
        `[v0] Upserting batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(validRows.length / BATCH_SIZE)} (${batch.length} rows)`
      )

      const { error: upsertError } = await supabase
        .from("proconnect_clients")
        .upsert(batch, {
          onConflict: "proconnect_client_id",
          ignoreDuplicates: false,
        })

      if (upsertError) {
        console.error("[v0] Batch upsert error:", upsertError.message)
        errorCount += batch.length
        errors.push({
          client_id: `batch_${Math.floor(i / BATCH_SIZE) + 1}`,
          error: upsertError.message,
        })
      } else {
        syncedCount += batch.length
      }
    }

    console.log("[v0] Upsert complete. Synced:", syncedCount, "Errors:", errorCount)

    // ─────────────────────────────────────────────────────────────────────────
    // Step 6: Update sync log
    // ─────────────────────────────────────────────────────────────────────────
    const finalStatus =
      errorCount === 0 ? "completed" : errorCount === validRows.length ? "failed" : "partial"

    await updateSyncLog(
      supabase,
      syncLogId,
      finalStatus,
      syncedCount,
      errors.length > 0 ? errors[0].error : null,
      errors.length > 0 ? errors : null
    )

    // ─────────────────────────────────────────────────────────────────────────
    // Done!
    // ─────────────────────────────────────────────────────────────────────────
    const durationMs = Date.now() - startTime
    console.log("[v0] ========== SYNC COMPLETE ==========")
    console.log("[v0] Duration:", durationMs, "ms")
    console.log("[v0] Status:", finalStatus)

    return new Response(
      JSON.stringify({
        success: finalStatus !== "failed",
        synced: syncedCount,
        errors: errorCount,
        duration_ms: durationMs,
      }),
      { status: 200, headers: corsHeaders }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined

    console.error("[v0] ========== UNHANDLED ERROR ==========")
    console.error("[v0] Error:", message)
    console.error("[v0] Stack:", stack)

    // Try to update sync log with error
    if (supabase! && syncLogId) {
      await updateSyncLog(supabase, syncLogId, "failed", 0, message, { stack })
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: message,
        stack: stack,
        duration_ms: Date.now() - startTime,
      }),
      { status: 500, headers: corsHeaders }
    )
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Update sync log entry
// ─────────────────────────────────────────────────────────────────────────────

async function updateSyncLog(
  supabase: SupabaseClient,
  logId: string | null,
  status: string,
  clientsSynced: number,
  errorMessage?: string | null,
  errorDetails?: unknown
): Promise<void> {
  if (!logId) {
    console.log("[v0] No sync log ID, skipping log update")
    return
  }

  console.log("[v0] Updating sync log:", logId, "status:", status)

  const { error } = await supabase
    .from("proconnect_sync_logs")
    .update({
      status,
      clients_synced: clientsSynced,
      completed_at: new Date().toISOString(),
      error_message: errorMessage || null,
      error_details: errorDetails || null,
    })
    .eq("id", logId)

  if (error) {
    console.error("[v0] Failed to update sync log:", error.message)
  }
}
