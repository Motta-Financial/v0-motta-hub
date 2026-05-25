// @ts-nocheck
/**
 * ProConnect Sync Custom Statuses - Supabase Edge Function (Deno Runtime)
 *
 * Pulls custom tax return statuses from ProConnect API and upserts them
 * into the proconnect_custom_statuses table. Logs the run in proconnect_sync_logs.
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

const PROCONNECT_CUSTOM_STATUS_URL =
  "https://engagement.accountant.intuit.com/v1/custom-status?source=ITO"
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

interface ProConnectCustomStatus {
  id: string
  label: string
}

interface ProConnectCustomStatusResponse {
  source: string
  customStatuses: ProConnectCustomStatus[]
}

interface SyncLogRow {
  id: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Map ProConnect status to proconnect_custom_statuses row
// ─────────────────────────────────────────────────────────────────────────────

function mapStatusToRow(status: ProConnectCustomStatus): Record<string, unknown> {
  const now = new Date().toISOString()
  return {
    status_id: status.id,
    name: status.label,
    raw_json: status,
    synced_at: now,
    updated_at: now,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Handler
// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const startTime = Date.now()
  console.log("[v0] ========== PROCONNECT-SYNC-CUSTOM-STATUSES INVOKED ==========")
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
        sync_type: "custom_statuses",
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
    // Step 3: Call ProConnect API to fetch custom statuses
    // ─────────────────────────────────────────────────────────────────────────
    console.log("[v0] Step 3: Calling ProConnect API...")
    console.log("[v0] URL:", PROCONNECT_CUSTOM_STATUS_URL)

    const apiResponse = await fetch(PROCONNECT_CUSTOM_STATUS_URL, {
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

    const responseData: ProConnectCustomStatusResponse = await apiResponse.json()
    const customStatuses = responseData.customStatuses || []
    console.log("[v0] Fetched", customStatuses.length, "custom statuses from ProConnect")

    // ─────────────────────────────────────────────────────────────────────────
    // Step 4: Map statuses to rows
    // ─────────────────────────────────────────────────────────────────────────
    console.log("[v0] Step 4: Mapping statuses to database rows...")

    const rows = customStatuses.map((status) => mapStatusToRow(status))
    console.log("[v0] Mapped", rows.length, "rows")

    // ─────────────────────────────────────────────────────────────────────────
    // Step 5: Upsert all rows into proconnect_custom_statuses
    // ─────────────────────────────────────────────────────────────────────────
    console.log("[v0] Step 5: Upserting rows to proconnect_custom_statuses...")

    let syncedCount = 0

    if (rows.length > 0) {
      const { error: upsertError } = await supabase
        .from("proconnect_custom_statuses")
        .upsert(rows, {
          onConflict: "status_id",
          ignoreDuplicates: false,
        })

      if (upsertError) {
        const errorMsg = `Upsert failed: ${upsertError.message}`
        console.error("[v0] ERROR:", errorMsg)
        await updateSyncLog(supabase, syncLogId, "failed", 0, errorMsg)
        return new Response(
          JSON.stringify({ success: false, error: errorMsg }),
          { status: 500, headers: corsHeaders }
        )
      }

      syncedCount = rows.length
      console.log("[v0] Upsert complete. Synced:", syncedCount)
    } else {
      console.log("[v0] No statuses to sync")
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step 6: Update sync log
    // ─────────────────────────────────────────────────────────────────────────
    await updateSyncLog(supabase, syncLogId, "success", syncedCount)

    // ─────────────────────────────────────────────────────────────────────────
    // Done!
    // ─────────────────────────────────────────────────────────────────────────
    const durationMs = Date.now() - startTime
    console.log("[v0] ========== SYNC COMPLETE ==========")
    console.log("[v0] Duration:", durationMs, "ms")
    console.log("[v0] Synced:", syncedCount)

    return new Response(
      JSON.stringify({
        success: true,
        synced: syncedCount,
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
      await updateSyncLog(supabase, syncLogId, "failed", 0, message)
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
  customStatusesSynced: number,
  errorMessage?: string | null
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
      custom_statuses_synced: customStatusesSynced,
      completed_at: new Date().toISOString(),
      error_message: errorMessage || null,
    })
    .eq("id", logId)

  if (error) {
    console.error("[v0] Failed to update sync log:", error.message)
  }
}
