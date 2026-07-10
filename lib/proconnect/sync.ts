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
  fetchAllEngagementsForYear,
  fetchCustomStatuses,
  extractClientEmail,
  extractClientId,
  extractClientName,
  RETURN_TYPE_MAP,
} from "./client"

// SUPABASE_URL is not set on every Vercel project that serves this repo —
// fall back to the public URL (same project) so cron/webhook code paths
// never build "undefined/..." URLs.
const SUPABASE_URL = (process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL)!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Tax years to sync (inclusive)
const TAX_YEARS = [2021, 2022, 2023, 2024, 2025, 2026]

// Number of clients to process in parallel
const PARALLEL_CLIENTS = 6

// Skip clients synced within this many hours (unless full reset)
const SKIP_IF_SYNCED_WITHIN_HOURS = 24

// Max execution time before we gracefully stop (Vercel timeout is 300s on Pro plan)
// Leave 15s buffer for cleanup and response serialization
const MAX_EXECUTION_MS = 285_000

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
    .select("status, last_client_index, started_at")
    .order("started_at", { ascending: false })
    .limit(1)
    .single()

  console.log("[v0] getResumeIndex query result:", {
    error: error?.message,
    status: data?.status,
    last_client_index: data?.last_client_index,
    started_at: data?.started_at,
  })

  if (error || !data) {
    console.log("[v0] getResumeIndex returning 0 (no data or error)")
    return 0
  }

  // Only resume if the last run was partial AND has a valid index > 0
  if (
    data.status === "partial" &&
    typeof data.last_client_index === "number" &&
    data.last_client_index > 0
  ) {
    console.log("[v0] getResumeIndex returning", data.last_client_index, "(resuming from partial)")
    return data.last_client_index
  }

  console.log("[v0] getResumeIndex returning 0 (last run was not partial or index was 0)")
  return 0
}

/**
 * Get accumulated counts from the most recent partial sync log.
 * When resuming, we need to add to these counts rather than starting from 0.
 */
async function getPreviousSyncCounts(supabase: SupabaseClient): Promise<{
  clientsSynced: number
  engagementsSynced: number
  customStatusesSynced: number
}> {
  const { data, error } = await supabase
    .from("proconnect_sync_logs")
    .select("status, clients_synced, engagements_synced, custom_statuses_synced")
    .order("started_at", { ascending: false })
    .limit(1)
    .single()

  if (error || !data || data.status !== "partial") {
    return { clientsSynced: 0, engagementsSynced: 0, customStatusesSynced: 0 }
  }

  return {
    clientsSynced: data.clients_synced ?? 0,
    engagementsSynced: data.engagements_synced ?? 0,
    customStatusesSynced: data.custom_statuses_synced ?? 0,
  }
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
      // NOTE: We deliberately do NOT pass hub_contact_id /
      // hub_organization_id in the upsert payload below. Three reasons:
      //   1. INSERTs are handled by the BEFORE INSERT trigger
      //      `auto_link_proconnect_to_hub` (scripts/151_*.sql), which
      //      already does the email + exact-name match.
      //   2. UPDATEs would otherwise clobber any auto_fuzzy mapping
      //      previously written by /api/tax/client-links/auto-link
      //      (e.g. the 198 organizations linked on
      //      2025-05-25 by scripts/apply-proconnect-auto-link.ts) —
      //      because matchClientToContact() returns null for any
      //      ORGANIZATION client (it only looks at contacts.email).
      //   3. Manual links written via /tax/settings (link_source=
      //      'manual') must also survive sync. Omitting the field is
      //      the only way Postgres preserves the existing value on a
      //      conflict-update.
      // If you ever need to *change* a hub link from sync, do it as a
      // dedicated UPDATE that respects link_source priority instead.

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
            // hub_contact_id intentionally omitted — see syncClients
            // for the full rationale. Trigger handles INSERTs; UPDATEs
            // preserve existing fuzzy/manual mappings.
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
 * Sync engagements for a single client across all tax years.
 * Returns the count and any errors.
 *
 * The 6 tax-year fetches run in parallel (Promise.allSettled) — this is
 * the dominant cost in syncEngagements. ProConnect's engagement endpoint
 * happily handles 6 concurrent reads per client and the savings drop
 * per-client wall time from ~9s sequential to ~1.5s parallel.
 */
async function syncClientEngagements(
  supabase: SupabaseClient,
  clientId: string
): Promise<{ count: number; errors: string[] }> {
  const yearResults = await Promise.allSettled(
    TAX_YEARS.map((year) => syncClientYear(supabase, clientId, year))
  )

  let count = 0
  const errors: string[] = []
  for (const r of yearResults) {
    if (r.status === "fulfilled") {
      count += r.value.count
      errors.push(...r.value.errors)
    } else {
      errors.push(
        `Client ${clientId} year fetch rejected: ${
          r.reason instanceof Error ? r.reason.message : String(r.reason)
        }`
      )
    }
  }

  return { count, errors }
}

/**
 * Sync engagements for a single (client, year) pair. Extracted so the
 * 6 years can run in parallel inside syncClientEngagements.
 */
async function syncClientYear(
  supabase: SupabaseClient,
  clientId: string,
  year: number
): Promise<{ count: number; errors: string[] }> {
  let count = 0
  const errors: string[] = []

  try {
    const response = await fetchEngagements(clientId, year)

    if (!response.ok) {
      // 404 is expected if client has no engagements for that year
      if (response.status !== 404) {
        errors.push(`Engagements ${clientId}/${year}: ${response.error}`)
      }
      return { count, errors }
    }

    if (!response.data || response.data.length === 0) {
      return { count, errors }
    }

    for (const engagement of response.data) {
      const eng = engagement as Record<string, unknown>
      const engagementId =
        (eng.id as string) ||
        (eng.engagementId as string) ||
        `${clientId}-${year}`

      // CRITICAL: Use the engagement's actual clientId from the API response,
      // NOT the clientId we queried with. ProConnect returns engagements that
      // may belong to different clients than the one we queried.
      const actualClientId = (eng.clientId as string) || clientId

      // Extract form type from raw API response
      const formType = (eng.type as string) || null
      const returnType = formType

      const { error } = await supabase.from("proconnect_engagements").upsert(
        {
          engagement_id: engagementId,
          proconnect_client_id: actualClientId,
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
          // Use engagement_id as the conflict key - it's globally unique.
          // The old composite key (proconnect_client_id,tax_year,return_type)
          // was broken because return_type is often null, causing overwrites.
          onConflict: "engagement_id",
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

  return { count, errors }
}

/**
 * Sync engagements for all clients across all tax years.
 * Supports resumable sync - starts from startIndex and tracks progress.
 * Processes clients in parallel batches of PARALLEL_CLIENTS.
 * Skips clients synced within SKIP_IF_SYNCED_WITHIN_HOURS unless forceFullSync.
 */
async function syncEngagements(
  supabase: SupabaseClient,
  startTime: number,
  startIndex: number = 0,
  forceFullSync: boolean = false
): Promise<{
  count: number
  errors: string[]
  timedOut: boolean
  lastClientIndex: number
  totalClients: number
  skippedClients: number
}> {
  console.log(
    `[v0] syncEngagements start (index ${startIndex}, forceFullSync=${forceFullSync})`
  )

  // Get all client IDs with their last sync time
  const { data: clients, error: clientError } = await supabase
    .from("proconnect_clients")
    .select("proconnect_client_id, updated_at")
    .order("proconnect_client_id", { ascending: true })

  if (clientError || !clients) {
    return {
      count: 0,
      errors: [clientError?.message || "Failed to get client IDs"],
      timedOut: false,
      lastClientIndex: startIndex,
      totalClients: 0,
      skippedClients: 0,
    }
  }

  // Get the last engagement sync time per client
  const { data: lastSyncs } = await supabase
    .from("proconnect_engagements")
    .select("proconnect_client_id, synced_at")
    .order("synced_at", { ascending: false })

  // Build a map of client_id -> last synced time
  const lastSyncMap = new Map<string, string>()
  for (const row of lastSyncs || []) {
    if (row.proconnect_client_id && !lastSyncMap.has(row.proconnect_client_id)) {
      lastSyncMap.set(row.proconnect_client_id, row.synced_at)
    }
  }

  const cutoffTime = Date.now() - SKIP_IF_SYNCED_WITHIN_HOURS * 60 * 60 * 1000

  let count = 0
  const errors: string[] = []
  let timedOut = false
  let lastClientIndex = startIndex
  let skippedClients = 0

  // Process clients in parallel batches starting from startIndex
  for (let i = startIndex; i < clients.length; i += PARALLEL_CLIENTS) {
    // Check timeout before processing each batch
    const elapsed = Date.now() - startTime
    if (elapsed > MAX_EXECUTION_MS) {
      console.log(
        `[v0] Timeout after ${i - startIndex} clients (index ${i}), ${elapsed}ms elapsed`
      )
      timedOut = true
      lastClientIndex = i
      break
    }

    // Get the next batch of clients
    const batch = clients.slice(i, Math.min(i + PARALLEL_CLIENTS, clients.length))

    // Filter out recently synced clients (unless force full sync)
    const clientsToSync: string[] = []
    for (const client of batch) {
      const clientId = client.proconnect_client_id
      if (!clientId) continue

      if (!forceFullSync) {
        const lastSync = lastSyncMap.get(clientId)
        if (lastSync && Date.parse(lastSync) > cutoffTime) {
          skippedClients++
          continue
        }
      }

      clientsToSync.push(clientId)
    }

    if (clientsToSync.length === 0) {
      lastClientIndex = i + batch.length
      continue
    }

    // Process this batch in parallel
    console.log(
      `[v0] Processing batch of ${clientsToSync.length} clients at index ${i}, ${Date.now() - startTime}ms elapsed`
    )

    const results = await Promise.all(
      clientsToSync.map((clientId) => syncClientEngagements(supabase, clientId))
    )

    // Aggregate results
    for (const result of results) {
      count += result.count
      errors.push(...result.errors)
    }

    // Update last processed index after each batch
    lastClientIndex = i + batch.length

    console.log(
      `[v0] Batch done: ${count} total engagements, ${Date.now() - startTime}ms elapsed`
    )
  }

  // If we processed all clients, reset to 0
  if (lastClientIndex >= clients.length) {
    lastClientIndex = 0
  }

  console.log(
    `[v0] syncEngagements done: ${count} engagements, ${skippedClients} skipped, timedOut=${timedOut}`
  )

  return {
    count,
    errors,
    timedOut,
    lastClientIndex,
    totalClients: clients.length,
    skippedClients,
  }
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

// ═══════════════════════════════════════════════════════════════════════════
// Bulk sync (per-year engagement fetch) — the nightly-cron strategy
// ═══════════════════════════════════════════════════════════════════════════

// First tax year ProConnect holds data for this firm.
const FIRST_TAX_YEAR = 2021

function taxYearsThroughCurrent(): number[] {
  const years: number[] = []
  for (let y = FIRST_TAX_YEAR; y <= new Date().getFullYear(); y++) years.push(y)
  return years
}

const UPSERT_BATCH_SIZE = 100

interface RawEngagement {
  engagementId?: string
  id?: string
  clientId?: string
  period?: string
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

/**
 * The e-file status lives in taxFiling.filings[].filingStatuses[], not in a
 * top-level `efileStatus` field. Pick the most recent status by date.
 */
function getLatestEfileStatus(eng: RawEngagement): string | null {
  let latest: { status?: string; date?: string } | null = null
  let latestDate = new Date(0)
  for (const filing of eng.taxFiling?.filings || []) {
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

function mapEngagementRow(raw: unknown, fallbackYear: number) {
  const eng = raw as RawEngagement
  const now = new Date().toISOString()
  const period = eng.period ? Number.parseInt(eng.period, 10) : NaN
  return {
    engagement_id: eng.engagementId || eng.id || null,
    proconnect_client_id: eng.clientId || null,
    tax_year: Number.isFinite(period) ? period : fallbackYear,
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
    raw_json: raw,
    synced_at: now,
    updated_at: now,
  }
}

interface RawClient {
  oiiClientId?: string
  id?: { value?: string } | string
  clientState?: string
  person?: RawClientEntity
  organization?: RawClientEntity
}

interface RawClientEntity {
  taxId?: string
  names?: Array<{ firstName?: string; lastName?: string; name?: string }>
  emailAddresses?: Array<{ address?: string; properties?: { isPrimary?: string } }>
  phoneNumbers?: Array<{ number?: string; properties?: { isPrimary?: string } }>
  physicalAddresses?: Array<{
    city?: string
    stateOrProvince?: string
    postalCode?: string
    properties?: { isPrimary?: string }
  }>
}

function getPrimary<T extends { properties?: { isPrimary?: string } }>(
  items: T[] | undefined
): T | undefined {
  if (!items || items.length === 0) return undefined
  return items.find((i) => i.properties?.isPrimary === "true") || items[0]
}

/**
 * Map a raw /v1/clients entry to a proconnect_clients row, including the
 * fields the auto-link trigger and the /tax UI depend on (client_type,
 * client_state, contact info). hub_contact_id / hub_organization_id are
 * intentionally omitted — see syncClients() for the rationale.
 */
export function mapClientRow(raw: unknown) {
  const client = raw as RawClient
  const names = extractClientName(raw)
  const contactSource = client.person || client.organization
  const primaryEmail = getPrimary(contactSource?.emailAddresses)
  const primaryPhone = getPrimary(contactSource?.phoneNumbers)
  const primaryAddress = getPrimary(contactSource?.physicalAddresses)
  const now = new Date().toISOString()

  return {
    proconnect_client_id:
      client.oiiClientId ||
      (typeof client.id === "string" ? client.id : client.id?.value) ||
      null,
    top_level_entity_id:
      typeof client.id === "object" ? (client.id?.value ?? null) : null,
    client_type: client.person
      ? "PERSON"
      : client.organization
        ? "ORGANIZATION"
        : null,
    client_state: client.clientState ?? null,
    first_name: names.firstName,
    last_name: names.lastName,
    business_name: names.businessName,
    display_name: names.displayName,
    name_for_matching: names.displayName?.toLowerCase() ?? null,
    email: primaryEmail?.address || extractClientEmail(raw),
    phone: primaryPhone?.number ?? null,
    city: primaryAddress?.city ?? null,
    state: primaryAddress?.stateOrProvince ?? null,
    zip: primaryAddress?.postalCode ?? null,
    tax_id: client.person?.taxId || client.organization?.taxId || null,
    raw_json: raw,
    synced_at: now,
    updated_at: now,
  }
}

/** Does a raw /v1/clients entry match a webhook entity id? */
function clientMatchesId(raw: unknown, targetId: string): boolean {
  const client = raw as RawClient
  const topLevelId =
    typeof client.id === "string" ? client.id : client.id?.value
  return client.oiiClientId === targetId || topLevelId === targetId
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Retry a ProConnect fetch on 429/5xx with exponential backoff. The
 * apiRequest layer surfaces those as ok=false with a status code.
 */
async function withRetry<T>(
  fn: () => Promise<{ ok: boolean; status: number; data: T | null; error: string | null }>,
  label: string,
  retries = 4
): Promise<{ ok: boolean; status: number; data: T | null; error: string | null }> {
  let last: { ok: boolean; status: number; data: T | null; error: string | null } = {
    ok: false,
    status: 0,
    data: null,
    error: "not attempted",
  }
  for (let attempt = 0; attempt < retries; attempt++) {
    last = await fn()
    if (last.ok || (last.status !== 429 && last.status < 500)) return last
    const backoff = 800 * Math.pow(2, attempt)
    console.log(`[ProConnect Sync] ${label}: ${last.status} — retrying in ${backoff}ms`)
    await sleep(backoff)
  }
  return last
}

/**
 * Bulk sync: clients (1 call) → engagements (1 call per tax year) →
 * custom statuses (1 call). ~8 API calls total instead of the legacy
 * per-client loop's ~12,000, so it comfortably completes inside a
 * single Vercel invocation. This is what the nightly cron runs.
 */
export async function runBulkSync(
  syncType: "full" | "manual" = "full"
): Promise<SyncResult> {
  const startTime = Date.now()
  const supabase = getSupabaseAdmin()
  const errors: string[] = []
  const syncLogId = await createSyncLog(supabase, syncType)

  let clientsSynced = 0
  let engagementsSynced = 0
  let customStatusesSynced = 0

  try {
    // ── 1. Clients ─────────────────────────────────────────────────────
    const clientsResp = await withRetry(() => fetchClients(), "clients")
    if (!clientsResp.ok || !clientsResp.data) {
      errors.push(`clients fetch failed: ${clientsResp.error}`)
    } else {
      const rows = clientsResp.data
        .map(mapClientRow)
        .filter((r) => r.proconnect_client_id)
      for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
        const batch = rows.slice(i, i + UPSERT_BATCH_SIZE)
        const { error } = await supabase
          .from("proconnect_clients")
          .upsert(batch, { onConflict: "proconnect_client_id" })
        if (error) {
          errors.push(`clients upsert @${i}: ${error.message}`)
        } else {
          clientsSynced += batch.length
        }
      }
    }

    // ── 2. Engagements, one bulk call per tax year ─────────────────────
    for (const year of taxYearsThroughCurrent()) {
      const resp = await withRetry(
        () => fetchAllEngagementsForYear(year),
        `engagements ${year}`
      )
      if (!resp.ok || !resp.data) {
        // 404 just means no engagements exist for that year
        if (resp.status !== 404) {
          errors.push(`engagements ${year} fetch failed: ${resp.error}`)
        }
        continue
      }
      const rows = resp.data
        .map((raw) => mapEngagementRow(raw, year))
        .filter((r) => r.engagement_id && r.proconnect_client_id)
      for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
        const batch = rows.slice(i, i + UPSERT_BATCH_SIZE)
        const { error } = await supabase
          .from("proconnect_engagements")
          .upsert(batch, { onConflict: "engagement_id" })
        if (error) {
          errors.push(`engagements ${year} upsert @${i}: ${error.message}`)
        } else {
          engagementsSynced += batch.length
        }
      }
    }

    // ── 3. Custom statuses ─────────────────────────────────────────────
    const statusResult = await syncCustomStatuses(supabase)
    customStatusesSynced = statusResult.count
    errors.push(...statusResult.errors)

    const success = errors.length === 0
    await updateSyncLog(supabase, syncLogId, {
      status: success ? "success" : "failed",
      clients_synced: clientsSynced,
      engagements_synced: engagementsSynced,
      custom_statuses_synced: customStatusesSynced,
      last_client_index: 0,
      error_message: success
        ? `Bulk sync: ${clientsSynced} clients, ${engagementsSynced} engagements in ${Math.round((Date.now() - startTime) / 1000)}s`
        : `${errors.length} errors occurred`,
      error_details: success ? null : { errors: errors.slice(0, 50) },
    })

    return {
      success,
      syncLogId,
      clientsSynced,
      engagementsSynced,
      customStatusesSynced,
      errors,
      duration: Date.now() - startTime,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error"
    errors.push(msg)
    await updateSyncLog(supabase, syncLogId, {
      status: "failed",
      clients_synced: clientsSynced,
      engagements_synced: engagementsSynced,
      custom_statuses_synced: customStatusesSynced,
      last_client_index: 0,
      error_message: msg,
      error_details: { errors: errors.slice(0, 50), stack: err instanceof Error ? err.stack : null },
    })
    return {
      success: false,
      syncLogId,
      clientsSynced,
      engagementsSynced,
      customStatusesSynced,
      errors,
      duration: Date.now() - startTime,
    }
  }
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

  // When resuming, load the previous run's accumulated counts so we can add to them
  let previousCounts = { clientsSynced: 0, engagementsSynced: 0, customStatusesSynced: 0 }
  if (isResuming) {
    console.log(`[ProConnect Sync] Resuming from client index ${resumeIndex}`)
    previousCounts = await getPreviousSyncCounts(supabase)
    console.log("[v0] Previous counts loaded:", previousCounts)
  }

  // Create sync log
  console.log("[v0] Step 2 start - createSyncLog", Date.now() - startTime, "ms elapsed")
  const syncLogId = await createSyncLog(supabase, syncType)
  console.log("[v0] Step 2 done - createSyncLog", Date.now() - startTime, "ms elapsed")

  // Track results outside try block so catch can access them for partial progress reporting
  let clientResult = { count: 0, errors: [] as string[] }
  let engagementResult = { count: 0, errors: [] as string[], timedOut: false, lastClientIndex: 0, totalClients: 0, skippedClients: 0 }
  let statusResult = { count: 0, errors: [] as string[] }

  try {
    // 1. Sync clients (only on fresh runs, not resumes)
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

    // 2. Sync engagements (this is the slow part - resumable, parallel, skip recent)
    // Force full sync on manual runs; incremental on cron/webhook
    const forceFullSync = syncType === "manual"
    console.log("[v0] Step 4 start - syncEngagements", Date.now() - startTime, "ms elapsed")
    engagementResult = await syncEngagements(supabase, startTime, resumeIndex, forceFullSync)
    console.log("[v0] Step 4 done - syncEngagements", Date.now() - startTime, "ms elapsed, count:", engagementResult.count, "skipped:", engagementResult.skippedClients)
    errors.push(...engagementResult.errors)
    timedOut = engagementResult.timedOut

    // Determine if this was a partial or complete run
    const isPartial = timedOut && engagementResult.lastClientIndex > 0
    const isComplete = engagementResult.lastClientIndex === 0 && !timedOut

    // 3. Sync custom statuses (only if we completed all clients and have time)
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

    // Accumulate counts from previous partial runs when resuming
    const totalClientsSynced = previousCounts.clientsSynced + clientResult.count
    const totalEngagementsSynced = previousCounts.engagementsSynced + engagementResult.count
    const totalStatusesSynced = previousCounts.customStatusesSynced + statusResult.count

    // Update sync log
    await updateSyncLog(supabase, syncLogId, {
      status,
      clients_synced: totalClientsSynced,
      engagements_synced: totalEngagementsSynced,
      custom_statuses_synced: totalStatusesSynced,
      last_client_index: engagementResult.lastClientIndex,
      error_message: isPartial
        ? `Partial sync: processed ${engagementResult.lastClientIndex}/${engagementResult.totalClients} clients (${engagementResult.skippedClients} skipped) in ${Math.round((Date.now() - startTime) / 1000)}s`
        : success
          ? `Synced ${totalEngagementsSynced} engagements (${engagementResult.skippedClients} clients skipped - already synced)`
          : `${errors.length} errors occurred`,
      error_details: isPartial
        ? {
            partial: true,
            lastClientIndex: engagementResult.lastClientIndex,
            totalClients: engagementResult.totalClients,
            skippedClients: engagementResult.skippedClients,
            errors: errors.slice(0, 20),
          }
        : success
          ? { skippedClients: engagementResult.skippedClients }
          : { errors: errors.slice(0, 50) },
    })

    return {
      success,
      syncLogId,
      clientsSynced: totalClientsSynced,
      engagementsSynced: totalEngagementsSynced,
      customStatusesSynced: totalStatusesSynced,
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
      // Accumulate counts from previous partial runs when resuming
      const totalClientsSynced = previousCounts.clientsSynced + clientResult.count
      const totalEngagementsSynced = previousCounts.engagementsSynced + engagementResult.count
      const totalStatusesSynced = previousCounts.customStatusesSynced + statusResult.count

      await updateSyncLog(supabase, syncLogId, {
        status: "partial",
        clients_synced: totalClientsSynced,
        engagements_synced: totalEngagementsSynced,
        custom_statuses_synced: totalStatusesSynced,
        last_client_index: engagementResult.lastClientIndex || resumeIndex || 1, // Save progress for resume
        error_message: `Partial sync: timed out after ${Math.round((Date.now() - startTime) / 1000)}s - will resume on next run`,
        error_details: {
          partial: true,
          timedOut: true,
          resumeIndex: engagementResult.lastClientIndex || resumeIndex,
          clientsSynced: totalClientsSynced,
          engagementsSynced: totalEngagementsSynced,
          stack: err instanceof Error ? err.stack : null,
        },
      })

      return {
        success: false,
        syncLogId,
        clientsSynced: totalClientsSynced,
        engagementsSynced: totalEngagementsSynced,
        customStatusesSynced: totalStatusesSynced,
        errors: [errorMessage],
        duration: Date.now() - startTime,
        timedOut: true,
        partial: true,
        lastClientIndex: engagementResult.lastClientIndex || resumeIndex,
      }
    }

    // Actual failure (not timeout) - still accumulate counts
    const totalClientsSynced = previousCounts.clientsSynced + clientResult.count
    const totalEngagementsSynced = previousCounts.engagementsSynced + engagementResult.count
    const totalStatusesSynced = previousCounts.customStatusesSynced + statusResult.count

    await updateSyncLog(supabase, syncLogId, {
      status: "failed",
      clients_synced: totalClientsSynced,
      engagements_synced: totalEngagementsSynced,
      custom_statuses_synced: totalStatusesSynced,
      last_client_index: engagementResult.lastClientIndex || resumeIndex, // Preserve resume point on failure
      error_message: errorMessage,
      error_details: { 
        stack: err instanceof Error ? err.stack : null,
        timedOut: false,
        resumeIndex: engagementResult.lastClientIndex || resumeIndex,
        clientsSynced: totalClientsSynced,
        engagementsSynced: totalEngagementsSynced,
      },
    })

    return {
      success: false,
      syncLogId,
      clientsSynced: totalClientsSynced,
      engagementsSynced: totalEngagementsSynced,
      customStatusesSynced: totalStatusesSynced,
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
 * Fetch the full client list once so a webhook batch with many Client
 * entities doesn't hit /v1/clients once per entity (that's what caused
 * the 429 bursts). Returns null on failure.
 */
export async function prefetchClientList(): Promise<unknown[] | null> {
  const response = await withRetry(() => fetchClients(), "clients (webhook prefetch)")
  return response.ok && response.data ? response.data : null
}

/**
 * Sync a single client (for webhook updates).
 *
 * ProConnect has no single-client GET (`/v1/clients/{id}` 404s), so we
 * pull the full list and filter by id. Pass `prefetchedClients` when
 * processing several Client events in one webhook delivery.
 */
export async function syncSingleClient(
  proconnectClientId: string,
  prefetchedClients?: unknown[] | null
): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseAdmin()

  try {
    let clients = prefetchedClients ?? null
    if (!clients) {
      clients = await prefetchClientList()
      if (!clients) {
        return { success: false, error: "Failed to fetch client list" }
      }
    }

    const client = clients.find((c) => clientMatchesId(c, proconnectClientId))
    if (!client) {
      // Deleted between the event and processing, or an id we don't
      // recognize. The nightly bulk sync is the safety net.
      return {
        success: false,
        error: `Client ${proconnectClientId} not present in /v1/clients response`,
      }
    }

    // hub_contact_id / hub_organization_id intentionally omitted from
    // the row (see syncClients / mapClientRow). INSERTs are handled by
    // the BEFORE-INSERT trigger; UPDATEs must preserve any auto_fuzzy /
    // manual mappings.
    const { error } = await supabase
      .from("proconnect_clients")
      .upsert(mapClientRow(client), { onConflict: "proconnect_client_id" })

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
 * Refresh all engagements for one (client, year) pair — used by the
 * TaxReturnWorkStatus webhook so status changes land without waiting
 * for the nightly sync. One API call.
 */
export async function refreshClientYearEngagements(
  proconnectClientId: string,
  taxYear: number
): Promise<{ success: boolean; count: number; error?: string }> {
  const supabase = getSupabaseAdmin()

  const resp = await withRetry(
    () => fetchEngagements(proconnectClientId, taxYear),
    `engagements ${proconnectClientId}/${taxYear}`
  )
  if (!resp.ok || !resp.data) {
    if (resp.status === 404) return { success: true, count: 0 }
    return { success: false, count: 0, error: resp.error || "fetch failed" }
  }

  // The engagement endpoint can return engagements belonging to other
  // clients — trust each row's own clientId (mapEngagementRow does).
  const rows = resp.data
    .map((raw) => mapEngagementRow(raw, taxYear))
    .filter((r) => r.engagement_id && r.proconnect_client_id)

  if (rows.length === 0) return { success: true, count: 0 }

  const { error } = await supabase
    .from("proconnect_engagements")
    .upsert(rows, { onConflict: "engagement_id" })

  if (error) return { success: false, count: 0, error: error.message }
  return { success: true, count: rows.length }
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
