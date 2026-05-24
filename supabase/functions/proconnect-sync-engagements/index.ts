// @ts-nocheck
/**
 * ProConnect Sync Engagements - Supabase Edge Function (Deno Runtime)
 *
 * Pulls ALL tax return engagements for a given year from ProConnect in a
 * single API call (the oiiClientId filter is ignored server-side) and
 * upserts them into proconnect_engagements.
 *
 * NO AUTH REQUIRED - Supabase gateway handles auth via apikey header.
 * "Verify JWT with legacy secret" should be OFF in function settings.
 *
 * Request body: { year: number, dryRun?: boolean }
 *
 * Env vars (auto-injected by Supabase):
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
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
const MAX_RETRIES = 5
const RETRY_BASE_MS = 600
const WALL_CLOCK_LIMIT_MS = 360_000 // stop 40s before Supabase's hard limit
const UPSERT_BATCH_SIZE = 100

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface StoredToken {
  access_token: string
  refresh_token: string
  expires_at: string
}

interface SyncRequest {
  year: number
  dryRun?: boolean
}

interface ProConnectEngagement {
  engagementId: string
  clientId: string
  period: string
  type?: string
  name?: string
  state?: string
  status?: string
  workStatus?: string
  userDefinedStatus?: string
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
  return_type: string | null
  form_type: string | null
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
    for (const s of filing.filingStatuses || []) {
      if (s.date) {
        const d = new Date(s.date)
        if (d > latestDate) {
          latestDate = d
          latest = s
        }
      }
    }
  }

  return latest?.status ?? null
}

function mapEngagementToRow(eng: ProConnectEngagement): MappedEngagement {
  if (!eng.type) {
    console.warn("[v0] Engagement missing type:", eng.engagementId)
  }

  const now = new Date().toISOString()
  return {
    engagement_id: eng.engagementId,
    proconnect_client_id: eng.clientId,
    tax_year: Number.parseInt(eng.period),
    return_type: eng.type ?? null,
    form_type: eng.type ?? null,
    engagement_name: eng.name ?? null,
    engagement_state: eng.state ?? null,
    status: eng.status ?? null,
    work_status: eng.workStatus ?? null,
    user_defined_status_id: eng.userDefinedStatus ?? null,
    efile_status: getLatestEfileStatus(eng),
    assignee_profile_id: eng.assignee?.profileId ?? null,
    assignee_auth_id: eng.assignee?.authId ?? null,
    created_by_profile_id: eng.createdBy?.profileId ?? null,
    modified_by_profile_id: eng.modifiedBy?.profileId ?? null,
    proconnect_created_at: eng.createdDate ?? null,
    proconnect_modified_at: eng.modifiedDate ?? null,
    raw_json: eng,
    synced_at: now,
    updated_at: now,
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

      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        const backoff = RETRY_BASE_MS * Math.pow(2, attempt)
        console.log(
          `[v0] Attempt ${attempt + 1}/${retries}: ${res.status} — backoff ${backoff}ms`,
        )
        await sleep(backoff)
        continue
      }

      return res
    } catch (e) {
      const backoff = RETRY_BASE_MS * Math.pow(2, attempt)
      console.log(`[v0] Attempt ${attempt + 1}/${retries}: fetch error — ${e}`)
      if (attempt < retries - 1) await sleep(backoff)
    }
  }

  throw new Error(`Failed after ${retries} retries`)
}

async function refreshTokenIfNeeded(
  supabase: SupabaseClient,
  token: StoredToken,
  serviceRoleKey: string,
): Promise<StoredToken> {
  const timeUntilExpiry =
    new Date(token.expires_at).getTime() - Date.now()

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

  // Re-read from DB — the refresh function body may not include access_token
  console.log(`[v0] Refresh OK — re-reading token from database`)

  const { data: fresh, error: readError } = await supabase
    .from("proconnect_oauth_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("is_singleton", true)
    .single()

  if (readError || !fresh) {
    throw new Error(
      `Failed to re-read token after refresh: ${readError?.message}`,
    )
  }

  if (!fresh.access_token) {
    throw new Error(
      "Re-read token row has no access_token — refresh may have failed silently",
    )
  }

  console.log("[v0] Refreshed token re-read from database")

  return {
    access_token: fresh.access_token,
    refresh_token: fresh.refresh_token,
    expires_at: fresh.expires_at,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Handler
// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  console.log(`[v0] Engagements sync request: ${req.method} ${req.url}`)

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
    const body: SyncRequest = await req.json()
    const year = body.year
    const dryRun = body.dryRun ?? false

    console.log(`[v0] Starting sync: year=${year}, dryRun=${dryRun}`)

    if (!year) {
      return new Response(
        JSON.stringify({ error: "year is required" }),
        { status: 400, headers: corsHeaders },
      )
    }

    // ── Supabase client ──────────────────────────────────────────────────────

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // ── OAuth token ──────────────────────────────────────────────────────────

    console.log(`[v0] Fetching stored OAuth token`)
    const { data: tokenRow, error: tokenError } = await supabase
      .from("proconnect_oauth_tokens")
      .select("access_token, refresh_token, expires_at")
      .eq("is_singleton", true)
      .single()

    if (tokenError || !tokenRow) {
      throw new Error(`Failed to fetch OAuth token: ${tokenError?.message}`)
    }

    const token = await refreshTokenIfNeeded(
      supabase,
      tokenRow as StoredToken,
      SUPABASE_SERVICE_ROLE_KEY,
    )

    // ── Fetch all engagements for the year (single API call) ─────────────────

    console.log(`[v0] Fetching all engagements for year ${year}`)

    const url = new URL(PROCONNECT_ENGAGEMENTS_URL)
    url.searchParams.set("source", "ITO")
    url.searchParams.set("period", String(year))

    const startTime = Date.now()

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
        `ProConnect API returned ${response.status}: ${text.slice(0, 500)}`,
      )
    }

    const data = await response.json()

    const engagements: ProConnectEngagement[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.engagements)
        ? data.engagements
        : Array.isArray(data?.items)
          ? data.items
          : Array.isArray(data?.data)
            ? data.data
            : []

    console.log(`[v0] API returned ${engagements.length} engagements for ${year}`)

    // ── Map ──────────────────────────────────────────────────────────────────

    const mappedEngagements = engagements.map(mapEngagementToRow)

    console.log(`[v0] Mapped ${mappedEngagements.length} engagements`)

    // ── Dry run ──────────────────────────────────────────────────────────────

    if (dryRun) {
      console.log(`[v0] Dry run — skipping upsert`)
      return new Response(
        JSON.stringify({
          success: true,
          status: "completed",
          year,
          engagementsFound: mappedEngagements.length,
          engagementsSynced: 0,
          sampleRows: mappedEngagements.slice(0, 3),
          errors: [],
          dryRun: true,
        } satisfies SyncResponse),
        { headers: corsHeaders },
      )
    }

    // ── Upsert in batches ────────────────────────────────────────────────────

    const errors: string[] = []
    let upsertedCount = 0

    for (let i = 0; i < mappedEngagements.length; i += UPSERT_BATCH_SIZE) {
      // Wall-clock guard — write what we have and report partial
      if (Date.now() - startTime > WALL_CLOCK_LIMIT_MS) {
        console.log(`[v0] Wall-clock limit reached at row ${i} — stopping`)
        errors.push(
          `Stopped at row ${i}/${mappedEngagements.length} — time limit`,
        )
        break
      }

      const batch = mappedEngagements.slice(
        i,
        Math.min(i + UPSERT_BATCH_SIZE, mappedEngagements.length),
      )

      console.log(
        `[v0] Upserting batch ${Math.floor(i / UPSERT_BATCH_SIZE) + 1}: rows ${i}–${i + batch.length - 1}`,
      )

      const { error: upsertError } = await supabase
        .from("proconnect_engagements")
        .upsert(batch, { onConflict: "engagement_id" })

      if (upsertError) {
        const msg = `Upsert error at row ${i}: ${upsertError.message}`
        console.error(`[v0] ${msg}`)
        errors.push(msg)
      } else {
        upsertedCount += batch.length
      }
    }

    const hitTimeLimit =
      errors.some((e) => e.includes("time limit")) ||
      Date.now() - startTime > WALL_CLOCK_LIMIT_MS
    const status = hitTimeLimit ? "partial" : "completed"

    console.log(
      `[v0] Sync ${status}: ${upsertedCount}/${mappedEngagements.length} engagements upserted`,
    )

    return new Response(
      JSON.stringify({
        success: errors.length === 0,
        status,
        year,
        engagementsFound: mappedEngagements.length,
        engagementsSynced: upsertedCount,
        errors,
        dryRun: false,
      } satisfies SyncResponse),
      { headers: corsHeaders },
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[v0] Fatal error: ${msg}`)

    return new Response(
      JSON.stringify({ success: false, status: "failed", error: msg }),
      { status: 500, headers: corsHeaders },
    )
  }
})
